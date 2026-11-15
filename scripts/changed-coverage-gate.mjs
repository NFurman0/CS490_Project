import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, relative, posix } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_COVERAGE_THRESHOLD = 80;

export const DEFAULT_COVERAGE_FILES = [
  'packages/shared/coverage/coverage-final.json',
  'apps/api/coverage/coverage-final.json',
  'apps/web/coverage/coverage-final.json',
];

export const EXCLUDED_PATTERNS = [
  {
    pattern: /\.test\.(?:ts|tsx|js|jsx|mjs)$/i,
    reason: 'Automated test files verify production code and are not gated for coverage.',
  },
  {
    pattern: /(?:^|\/)test\//,
    reason: 'Test helpers, fixtures, and integration test suites are excluded.',
  },
  {
    pattern: /^apps\/web\/src\/test-setup\.ts$/,
    reason: 'Vitest DOM setup file.',
  },
  {
    pattern: /^apps\/api\/src\/server\.ts$/,
    reason: 'Process bootstrap entrypoint that wires adapters and starts listening.',
  },
  {
    pattern: /^apps\/web\/src\/main\.tsx$/,
    reason: 'Browser DOM mount entrypoint.',
  },
  {
    pattern: /^apps\/api\/prisma\//,
    reason: 'Prisma schema and SQL migrations.',
  },
  {
    pattern: /^apps\/api\/scripts\//,
    reason: 'Developer utility scripts.',
  },
  {
    pattern: /\.d\.ts$/,
    reason: 'TypeScript declaration files contain no runtime code.',
  },
  {
    pattern: /^(?:docs|ai-transcripts|\.github|\.vscode|scripts)\//,
    reason: 'Documentation, transcripts, CI workflows, and tooling scripts.',
  },
];

const SOURCE_FILE_PATTERN = /^(?:apps|packages)\/[^/]+\/src\/.+\.(?:ts|tsx)$/;

export function toPosixPath(filePath) {
  return filePath.split('\\').join('/');
}

export function isExcludedFile(repoRelPath) {
  const normalized = toPosixPath(repoRelPath);
  if (!SOURCE_FILE_PATTERN.test(normalized)) {
    return true;
  }
  return EXCLUDED_PATTERNS.some((entry) => entry.pattern.test(normalized));
}

/**
 * Parses `git diff -U0` output and returns a Map of repo-relative POSIX path -> sorted added/modified 1-based line numbers.
 */
export function parseGitDiffAddedLines(diffText) {
  const changedLinesByFile = new Map();
  let currentFile = null;

  for (const line of diffText.split(/\r?\n/)) {
    if (line.startsWith('+++ b/')) {
      currentFile = toPosixPath(line.slice('+++ b/'.length).trim());
      if (!changedLinesByFile.has(currentFile)) {
        changedLinesByFile.set(currentFile, new Set());
      }
      continue;
    }

    if (line.startsWith('+++ /dev/null')) {
      currentFile = null;
      continue;
    }

    if (line.startsWith('@@ ') && currentFile) {
      const match = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
      if (!match) continue;
      const startLine = Number.parseInt(match[1], 10);
      const lineCount = match[2] !== undefined ? Number.parseInt(match[2], 10) : 1;
      if (lineCount === 0) continue;

      const lines = changedLinesByFile.get(currentFile);
      for (let offset = 0; offset < lineCount; offset += 1) {
        lines.add(startLine + offset);
      }
    }
  }

  const result = new Map();
  for (const [file, lineSet] of changedLinesByFile.entries()) {
    if (lineSet.size > 0) {
      result.set(
        file,
        [...lineSet].sort((a, b) => a - b),
      );
    }
  }
  return result;
}

/**
 * Loads and merges Istanbul `coverage-final.json` maps, keyed by repo-relative POSIX path.
 */
export function loadCoverageMaps(repoRoot, coverageFilePaths = DEFAULT_COVERAGE_FILES) {
  const merged = new Map();

  for (const relPath of coverageFilePaths) {
    const absPath = resolve(repoRoot, relPath);
    if (!existsSync(absPath)) continue;

    const raw = JSON.parse(readFileSync(absPath, 'utf8'));
    for (const [fileKey, fileCoverage] of Object.entries(raw)) {
      const targetPath = fileCoverage?.path ?? fileKey;
      const repoRel = toPosixPath(relative(repoRoot, targetPath));
      merged.set(repoRel, fileCoverage);
    }
  }

  return merged;
}

/**
 * Builds a Map<lineNumber, isCovered> from an Istanbul file coverage entry.
 * A line is coverable if at least one statement or function declaration starts on it,
 * and covered if any statement/function on that line has execution count > 0.
 */
export function buildLineCoverageStatus(fileCoverage) {
  const lineStatus = new Map();

  const recordLine = (line, count) => {
    if (!Number.isInteger(line) || line <= 0) return;
    const prev = lineStatus.get(line) ?? false;
    lineStatus.set(line, prev || count > 0);
  };

  const statementMap = fileCoverage.statementMap ?? {};
  const statements = fileCoverage.s ?? {};
  for (const [id, loc] of Object.entries(statementMap)) {
    const count = statements[id] ?? 0;
    const startLine = loc?.start?.line;
    recordLine(startLine, count);
  }

  const fnMap = fileCoverage.fnMap ?? {};
  const fns = fileCoverage.f ?? {};
  for (const [id, fnMeta] of Object.entries(fnMap)) {
    const count = fns[id] ?? 0;
    const startLine = fnMeta?.decl?.start?.line ?? fnMeta?.loc?.start?.line;
    recordLine(startLine, count);
  }

  return lineStatus;
}

function isLikelyNonExecutableLine(lineText) {
  const trimmed = lineText.trim();
  if (trimmed.length === 0) return true;
  if (
    trimmed.startsWith('//') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('*/')
  ) {
    return true;
  }
  if (
    trimmed.startsWith('import ') ||
    trimmed.startsWith('export type ') ||
    trimmed.startsWith('type ') ||
    trimmed.startsWith('interface ')
  ) {
    return true;
  }
  if (trimmed === '{' || trimmed === '}' || trimmed === '};' || trimmed === ');') {
    return true;
  }
  return false;
}

/**
 * Evaluates changed-line coverage across all changed files.
 */
export function evaluateChangedCoverage({
  changedLinesByFile,
  coverageByFile,
  threshold = DEFAULT_COVERAGE_THRESHOLD,
  readFile = (relPath) => readFileSync(relPath, 'utf8'),
}) {
  const fileResults = [];
  let totalCoverable = 0;
  let totalCovered = 0;

  for (const [filePath, changedLines] of changedLinesByFile.entries()) {
    if (isExcludedFile(filePath)) {
      continue;
    }

    const fileCoverage = coverageByFile.get(filePath);
    const coveredLines = [];
    const uncoveredLines = [];

    if (fileCoverage) {
      const lineStatus = buildLineCoverageStatus(fileCoverage);
      for (const line of changedLines) {
        if (!lineStatus.has(line)) continue;
        if (lineStatus.get(line)) {
          coveredLines.push(line);
        } else {
          uncoveredLines.push(line);
        }
      }
    } else {
      // File was not imported by any test at all; count changed executable lines as uncovered.
      let sourceLines;
      try {
        sourceLines = readFile(filePath).split(/\r?\n/);
      } catch {
        sourceLines = [];
      }

      for (const line of changedLines) {
        const text = sourceLines[line - 1] ?? '';
        if (!isLikelyNonExecutableLine(text)) {
          uncoveredLines.push(line);
        }
      }
    }

    const coverableCount = coveredLines.length + uncoveredLines.length;
    if (coverableCount === 0) {
      continue;
    }

    totalCoverable += coverableCount;
    totalCovered += coveredLines.length;

    const coveragePercent = Number(((coveredLines.length / coverableCount) * 100).toFixed(2));
    fileResults.push({
      filePath,
      coveredCount: coveredLines.length,
      coverableCount,
      coveragePercent,
      uncoveredLines,
    });
  }

  const overallPercent =
    totalCoverable === 0 ? 100 : Number(((totalCovered / totalCoverable) * 100).toFixed(2));
  const passed = totalCoverable === 0 || overallPercent >= threshold;

  return {
    passed,
    threshold,
    totalCovered,
    totalCoverable,
    overallPercent,
    files: fileResults.sort((a, b) => a.filePath.localeCompare(b.filePath)),
  };
}

export function formatCoverageSummary(evaluation) {
  const lines = [];
  lines.push('## Changed-Code Coverage Gate (S2-001)');
  lines.push('');

  if (evaluation.totalCoverable === 0) {
    lines.push(
      `No coverable source lines were changed. Gate passed (${evaluation.threshold}% threshold).`,
    );
    return lines.join('\n');
  }

  const statusLabel = evaluation.passed ? 'PASSED' : 'FAILED';
  lines.push(
    `**Status:** ${statusLabel} — **${evaluation.overallPercent}%** (${evaluation.totalCovered}/${evaluation.totalCoverable} changed lines covered; required >= **${evaluation.threshold}%**)`,
  );
  lines.push('');
  lines.push('| File | Covered / Changed | Coverage | Uncovered Lines |');
  lines.push('| --- | --- | --- | --- |');

  for (const file of evaluation.files) {
    const uncovered = file.uncoveredLines.length > 0 ? file.uncoveredLines.join(', ') : 'None';
    lines.push(
      `| \`${file.filePath}\` | ${file.coveredCount}/${file.coverableCount} | ${file.coveragePercent}% | ${uncovered} |`,
    );
  }

  return lines.join('\n');
}

function resolveDefaultBaseRef(repoRoot) {
  if (process.env.COVERAGE_BASE_REF) {
    return process.env.COVERAGE_BASE_REF;
  }

  const candidates = ['origin/main', 'main', 'HEAD~1'];
  for (const ref of candidates) {
    try {
      execFileSync('git', ['rev-parse', '--verify', ref], {
        cwd: repoRoot,
        stdio: 'ignore',
      });
      return ref;
    } catch {
      // Try next candidate ref.
    }
  }
  return 'HEAD';
}

function getGitDiff(repoRoot, baseRef) {
  return execFileSync('git', ['diff', '--unified=0', '--diff-filter=AM', `${baseRef}...HEAD`], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
}

function parseCliArgs(argv) {
  const args = { threshold: DEFAULT_COVERAGE_THRESHOLD, baseRef: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--threshold' && argv[i + 1]) {
      args.threshold = Number(argv[i + 1]);
      i += 1;
    } else if (arg === '--base' && argv[i + 1]) {
      args.baseRef = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function main() {
  const repoRoot = process.cwd();
  const { threshold, baseRef: cliBase } = parseCliArgs(process.argv.slice(2));
  const baseRef = cliBase ?? resolveDefaultBaseRef(repoRoot);

  const diffText = getGitDiff(repoRoot, baseRef);
  const changedLinesByFile = parseGitDiffAddedLines(diffText);
  const coverageByFile = loadCoverageMaps(repoRoot);

  const evaluation = evaluateChangedCoverage({
    changedLinesByFile,
    coverageByFile,
    threshold,
    readFile: (relPath) => readFileSync(posix.normalize(resolve(repoRoot, relPath)), 'utf8'),
  });

  const summary = formatCoverageSummary(evaluation);
  console.log(summary);

  if (process.env.GITHUB_STEP_SUMMARY) {
    execFileSync('sh', ['-c', 'cat >> "$GITHUB_STEP_SUMMARY"'], {
      input: `${summary}\n`,
    });
  }

  if (!evaluation.passed) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}

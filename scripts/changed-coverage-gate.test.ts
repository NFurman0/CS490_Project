import { describe, expect, it } from 'vitest';
import {
  buildLineCoverageStatus,
  evaluateChangedCoverage,
  formatCoverageSummary,
  isExcludedFile,
  parseGitDiffAddedLines,
} from './changed-coverage-gate.mjs';

describe('changed-coverage-gate (S2-001)', () => {
  it('parses added and modified line numbers from unified git diff hunks', () => {
    const diff = [
      'diff --git a/apps/api/src/modules/targets/targets.service.ts b/apps/api/src/modules/targets/targets.service.ts',
      'index 1111111..2222222 100644',
      '--- a/apps/api/src/modules/targets/targets.service.ts',
      '+++ b/apps/api/src/modules/targets/targets.service.ts',
      '@@ -10,0 +11,3 @@ export function example() {',
      '+  const a = 1;',
      '+  const b = 2;',
      '+  return a + b;',
      '@@ -25 +28,0 @@ export function removed() {',
      '-  const old = true;',
    ].join('\n');

    const parsed = parseGitDiffAddedLines(diff);
    expect(parsed.get('apps/api/src/modules/targets/targets.service.ts')).toEqual([11, 12, 13]);
  });

  it('excludes test files, docs, prisma migrations, and bootstrap entrypoints', () => {
    expect(isExcludedFile('apps/api/src/modules/targets/targets.service.test.ts')).toBe(true);
    expect(isExcludedFile('apps/api/test/helpers/scope-guard-evaluator.ts')).toBe(true);
    expect(isExcludedFile('apps/api/src/server.ts')).toBe(true);
    expect(isExcludedFile('apps/web/src/main.tsx')).toBe(true);
    expect(isExcludedFile('docs/coverage-gate.md')).toBe(true);
    expect(isExcludedFile('apps/api/src/modules/targets/targets.service.ts')).toBe(false);
    expect(isExcludedFile('packages/shared/src/errors.ts')).toBe(false);
  });

  it('fails the gate when a deliberately under-tested change falls below the threshold', () => {
    const changedLinesByFile = new Map([
      ['apps/api/src/modules/targets/targets.service.ts', [10, 11, 12, 13]],
    ]);

    const coverageByFile = new Map([
      [
        'apps/api/src/modules/targets/targets.service.ts',
        {
          statementMap: {
            0: { start: { line: 10, column: 2 }, end: { line: 10, column: 20 } },
            1: { start: { line: 11, column: 2 }, end: { line: 11, column: 20 } },
            2: { start: { line: 12, column: 2 }, end: { line: 12, column: 20 } },
            3: { start: { line: 13, column: 2 }, end: { line: 13, column: 20 } },
          },
          s: { 0: 1, 1: 0, 2: 0, 3: 0 },
          fnMap: {},
          f: {},
        },
      ],
    ]);

    const result = evaluateChangedCoverage({
      changedLinesByFile,
      coverageByFile,
      threshold: 80,
    });

    expect(result.passed).toBe(false);
    expect(result.overallPercent).toBe(25);
    expect(result.files[0]?.uncoveredLines).toEqual([11, 12, 13]);

    const summary = formatCoverageSummary(result);
    expect(summary).toContain('FAILED');
    expect(summary).toContain('11, 12, 13');
  });

  it('fails the gate when a newly added source file has no tests importing it', () => {
    const changedLinesByFile = new Map([
      ['apps/api/src/modules/qa/untested.service.ts', [1, 2, 3, 4]],
    ]);
    const coverageByFile = new Map();

    const result = evaluateChangedCoverage({
      changedLinesByFile,
      coverageByFile,
      threshold: 80,
      readFile: () =>
        [
          "import { AppError } from '../../lib/errors.js';",
          'export function untestedHelper(flag: boolean) {',
          "  if (flag) throw new AppError('INTERNAL_ERROR', 500, 'boom');",
          '  return true;',
          '}',
        ].join('\n'),
    });

    expect(result.passed).toBe(false);
    expect(result.overallPercent).toBe(0);
    expect(result.files[0]?.uncoveredLines).toEqual([2, 3, 4]);
  });

  it('passes when changed lines meet or exceed the 80% threshold', () => {
    const changedLinesByFile = new Map([['packages/shared/src/errors.ts', [20, 21, 22, 23, 24]]]);

    const coverageByFile = new Map([
      [
        'packages/shared/src/errors.ts',
        {
          statementMap: {
            0: { start: { line: 20, column: 2 }, end: { line: 20, column: 20 } },
            1: { start: { line: 21, column: 2 }, end: { line: 21, column: 20 } },
            2: { start: { line: 22, column: 2 }, end: { line: 22, column: 20 } },
            3: { start: { line: 23, column: 2 }, end: { line: 23, column: 20 } },
            4: { start: { line: 24, column: 2 }, end: { line: 24, column: 20 } },
          },
          s: { 0: 2, 1: 2, 2: 2, 3: 2, 4: 0 },
          fnMap: {},
          f: {},
        },
      ],
    ]);

    const result = evaluateChangedCoverage({
      changedLinesByFile,
      coverageByFile,
      threshold: 80,
    });

    expect(result.passed).toBe(true);
    expect(result.overallPercent).toBe(80);
    expect(result.files[0]?.uncoveredLines).toEqual([24]);
  });

  it('passes cleanly when a PR changes only docs, tests, or non-coverable lines', () => {
    const changedLinesByFile = new Map([
      ['docs/coverage-gate.md', [1, 2, 3]],
      ['apps/api/test/helpers/scope-guard-evaluator.test.ts', [10, 11]],
    ]);

    const result = evaluateChangedCoverage({
      changedLinesByFile,
      coverageByFile: new Map(),
      threshold: 80,
    });

    expect(result.passed).toBe(true);
    expect(result.totalCoverable).toBe(0);
    expect(formatCoverageSummary(result)).toContain('No coverable source lines were changed');
  });

  it('marks a line covered if either a statement or function declaration on that line executed', () => {
    const lineStatus = buildLineCoverageStatus({
      statementMap: {
        0: { start: { line: 5, column: 2 }, end: { line: 5, column: 10 } },
      },
      s: { 0: 0 },
      fnMap: {
        0: { decl: { start: { line: 5, column: 0 }, end: { line: 5, column: 15 } } },
      },
      f: { 0: 1 },
    });

    expect(lineStatus.get(5)).toBe(true);
  });
});

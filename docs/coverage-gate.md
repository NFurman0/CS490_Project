# Changed-Code Coverage Gate (`S2-001`)

This document describes the automated changed-code coverage gate implemented for `S2-001` (`S2-BR-027` through `S2-BR-031`).

## 1. Selected Coverage Mechanism

ReviewLens uses **Vitest's V8 coverage provider** (`@vitest/coverage-v8`) across all three workspaces (`packages/shared`, `apps/api`, and `apps/web`) to generate Istanbul-format JSON coverage reports (`coverage/coverage-final.json`), paired with `scripts/changed-coverage-gate.mjs`.

On pull requests, the gate:

1. Runs all unit and integration tests with V8 coverage enabled (`npm run coverage`).
2. Computes the unified git diff of added and modified lines (`git diff --unified=0 --diff-filter=AM <baseRef>...HEAD`).
3. Maps every changed, non-excluded source line to its statement and function execution counts in `coverage-final.json` (and flags changed executable lines in newly added source files that have zero test imports as uncovered).
4. Prints a per-file table showing covered/changed lines, percentages, and exact uncovered line numbers, and exits non-zero if the overall changed-line coverage is below the threshold.

## 2. Required Threshold and Policy

- **Minimum Changed-Line Coverage:** **80%** (`DEFAULT_COVERAGE_THRESHOLD = 80`).
- **Scope:** Only lines added or modified in the PR are measured, so older untested files do not block unrelated work.
- **No-Op PRs:** PRs that touch zero coverable source lines (for example, documentation-only, test-only, or config-only PRs) pass automatically.

## 3. Excluded Code and Rationale

| Path / Pattern | Why Excluded |
| --- | --- |
| `**/*.test.{ts,tsx}`, `apps/api/test/**`, `apps/web/src/test-setup.ts` | Automated test files, helpers, and fixtures verify production code and are not production behavior themselves. |
| `apps/api/src/server.ts`, `apps/web/src/main.tsx` | Process and browser bootstrap entrypoints that wire dependencies and start the server or DOM root. |
| `apps/api/prisma/**`, `apps/api/scripts/**` | Database schema/migrations and developer CLI utilities. |
| `**/*.d.ts` | TypeScript declaration files contain no runtime statements. |
| `docs/**`, `ai-transcripts/**`, `.github/**`, `.vscode/**`, `scripts/**` | Documentation, AI transcripts, CI definitions, editor settings, and repo tooling. |
| Non-executable lines (blank lines, comments, pure `type`/`interface` declarations) | V8 instruments runtime statements and functions; comments and TypeScript-only types have no runtime code. |

## 4. Running the Coverage Check Locally

From the repository root:

```bash
# Run tests with coverage across all workspaces and enforce the changed-code gate against origin/main
npm run coverage:check
```

To run the gate against an already-generated coverage report or customize the base branch/threshold:

```bash
# Compare against a specific base ref or threshold
node scripts/changed-coverage-gate.mjs --base origin/main --threshold 80
```

To include the database-backed integration tests locally (matching CI), start the isolated test database first:

```bash
npm run db:test:up
npm run coverage:check
npm run db:test:down
```

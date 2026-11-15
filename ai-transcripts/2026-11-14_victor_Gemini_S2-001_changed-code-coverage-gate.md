# 2026-11-14 — Victor Jimenez — Gemini — S2-001 — Changed-Code Coverage Gate

## Story Context

- **Story:** `S2-001` — Add Changed-Code Coverage Gate (GitHub Issue `#51`)
- **Outcome:** The CI pipeline measures automated test coverage for changed or newly added code and rejects a pull request that fails the team's required threshold.
- **Canonical Rules:** `S2-BR-027` through `S2-BR-031`
- **Standards Followed:** `docs/engineering-standards.md`, `docs/security-guardrails.md`, `docs/AI_assisted_development.md`

---

## Prompt & Conversation Summary

1. **User Request:** Implement `S2-001` (Add Changed-Code Coverage Gate) on a separate branch following repository conventions, verify quality gates, and prepare the PR.
2. **Branch & Dependency Verification:**
   - Checked out `victor/S2-001` from `main`.
   - Verified `@vitest/coverage-v8@5.1.0` (MIT license, `vitest-dev/vitest`) matches the repository's installed `vitest@5.1.0` version and installed it as a root `devDependency`.
3. **Implementation:**
   - `scripts/changed-coverage-gate.mjs`: Parses `git diff --unified=0 --diff-filter=AM <baseRef>...HEAD`, merges Istanbul `coverage-final.json` reports from `packages/shared`, `apps/api`, and `apps/web`, applies documented exclusions, evaluates changed-line coverage against the 80% threshold (flagging untouched new source files as 0% covered), prints a Markdown summary with exact uncovered line numbers, writes to `$GITHUB_STEP_SUMMARY`, and exits non-zero when coverage falls short.
   - `scripts/changed-coverage-gate.test.ts`: Added 7 unit tests covering diff hunk parsing, exclusion patterns, failing under-tested changes, untouched new source files, passing >= 80% changes, no-op/docs-only PRs, and function/statement line merging.
   - `package.json` (root + `packages/shared`, `apps/api`, `apps/web`): Added `coverage`, `coverage:gate`, and `coverage:check` scripts.
   - `.github/workflows/ci.yml`: Updated the `test` job to fetch full git history (`fetch-depth: 0`), run `npm run coverage` and `scripts/changed-coverage-gate.test.ts`, and enforce `npm run coverage:gate -- --base "origin/${{ github.base_ref }}"` on pull requests.
   - `docs/coverage-gate.md`: Documented the selected coverage mechanism, 80% threshold/policy, exclusions and rationale, and local execution commands.
   - `eslint.config.js`: Enabled Node globals for `scripts/**/*.{js,mjs,ts}`.
4. **Verification:**
   - Ran `npm run format`, `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run build`, `npm run coverage` (unit suites), `vitest run scripts/changed-coverage-gate.test.ts`, and `npm run coverage:gate` locally.

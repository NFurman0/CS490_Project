# Demo setup and rehearsal

**Source snapshot:** [`b0d120b`](https://github.com/NFurman0/CS490_Project/tree/b0d120bcd25469992fbc4a7116308514302ce876), inspected November 10, 2026. Main now includes normalization, persisted reviews, review/ingestion authorization, and result reporting from merged PRs [#45](https://github.com/NFurman0/CS490_Project/pull/45), [#47](https://github.com/NFurman0/CS490_Project/pull/47), [#41](https://github.com/NFurman0/CS490_Project/pull/41), and [#48](https://github.com/NFurman0/CS490_Project/pull/48).

**Evidence boundary:** This refresh checks source and test coverage; it does not record a new live rehearsal or application test run. The November 9 live result below used `6f79e84`, before review storage, and proves saved run metadata only. Current-main review persistence and two-account behavior still need live verification on the revision being demonstrated.

Use this checklist to repeat the demo and record what passes. Follow the course rubric for the presentation order and required evidence. An unchecked item is unverified.

## Prepare the machine

- Use Node.js 24 from `.nvmrc`, npm, and Docker Compose with a running Docker daemon (the README recommends Docker Desktop). With nvm on macOS/Linux, run `nvm use` from the repository root. On Windows, select Node 24 with your installed Node version manager.
- Keep the default ports available: web `5173`, API `3000`, development PostgreSQL `5432`, and test PostgreSQL `5433`.
- Obtain the team's real Clerk development keys and a SerpApi key through the provider dashboards or approved password manager. Prepare two distinct Clerk accounts in separate browser profiles. See [README: Signing in locally](../README.md#signing-in-locally) for matching Clerk keys and [environment configuration](../README.md#environment-configuration) for where values belong.

Run commands from the repository root. Create missing environment files without replacing existing credentials.

macOS/Linux:

```bash
test -e apps/api/.env || cp apps/api/.env.example apps/api/.env
test -e apps/web/.env || cp apps/web/.env.example apps/web/.env
test -e apps/api/.env.test || cp apps/api/.env.test.example apps/api/.env.test
```

Windows PowerShell:

```powershell
if (-not (Test-Path apps/api/.env)) { Copy-Item apps/api/.env.example apps/api/.env }
if (-not (Test-Path apps/web/.env)) { Copy-Item apps/web/.env.example apps/web/.env }
if (-not (Test-Path apps/api/.env.test)) { Copy-Item apps/api/.env.test.example apps/api/.env.test }
```

Fill in the API and web files using their template comments and the README. Keep secrets out of `VITE_` variables, screenshots, terminal output, and transcripts. Placeholder keys cannot start the live app. The automated tests use fake identities and recorded provider responses; they do not require live provider keys.

For the first live connection check, set `MAX_REVIEWS_PER_RUN=1` in the ignored `apps/api/.env`, restart the API, and run ingestion once. This limits the check to one provider-page request. The default cap of 50 limits raw reviews returned by the adapter before normalization; it does not guarantee 50 usable or saved reviews and is not a search budget. Partially filled pages can require more than the four searches estimated in the ingestion notes. Increase the cap only after verifying the first result and available quota. Do not run ingestion simultaneously in multiple tabs.

**Check `apps/api/.env.test` before testing.** It must point to the dedicated local `reviewlens_test` database on port `5433`, as in the template. Database tests delete rows between cases. Never use the development demo database or any database containing real data. A configured shell `DATABASE_URL` can also be used when the test file is absent, so do not rely on an inherited value.

```bash
npm ci
npm run db:up
```

`db:up` starts PostgreSQL 17 and applies migrations. See [README: First-time setup](../README.md#first-time-setup) for the normal development workflow.

## Verify before rehearsal

Start the isolated database, then run the five quality gates:

```bash
npm run db:test:up
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
npm run db:test:down
```

Check each result before continuing. If a check fails, preserve the failure and stop the test database when finished investigating. `npm test` can pass while database suites are skipped if no test database is configured. Confirm that the target/review persistence, ownership, cross-user authorization, and ingestion database suites ran; skipped suites are not acceptance evidence.

- [ ] Lint, formatting, typecheck, tests, and build pass on the revision being demonstrated.
- [ ] Database suites ran against the isolated database with no skips.
- [ ] Record the revision, commands, results, and any blockers in the PR or demo notes without credentials or private review content.

CI defines four jobs: **Lint and format**, **Typecheck**, **Unit and integration tests**, and **Build**. A green workflow is evidence that its checks ran on that revision. It does not by itself prove GitHub blocks merges when a check fails. Verify required-check enforcement in the repository's active ruleset or branch protection before claiming it; the workflow comments alone are not enforcement evidence.

The existing acceptance tests are:

| Evidence                                                                                          | Existing test file                                                                                                                  |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Authentication and anonymous rejection                                                            | `apps/api/test/integration/auth.test.ts`                                                                                            |
| Target creation, persistence, owner-only lists, read/delete ownership, input validation           | `apps/api/test/integration/analysis-targets-persistence.test.ts`                                                                    |
| Identity mapping and server-assigned ownership                                                    | `apps/api/test/integration/ownership.test.ts`                                                                                       |
| Ingestion owner success, latest-run reads, anonymous/cross-user denial, stored failed-run outcome | `apps/api/test/integration/ingestion.test.ts`                                                                                       |
| Provider failures, timeouts, pagination, caps, and safe logging                                   | `apps/api/src/adapters/serpapi/serpapi-review-source.test.ts`                                                                       |
| Provider outcomes, normalized counts, partial results and save-failure handling                   | `apps/api/src/modules/ingestion/ingestion.service.test.ts`                                                                          |
| Sign-in protection and logout behavior                                                            | `apps/web/src/app/App.test.tsx`                                                                                                     |
| Creation feedback and target-list states                                                          | `apps/web/src/features/targets/pages/CreateTargetPage.test.tsx`, `apps/web/src/features/workspace/pages/WorkspaceHomePage.test.tsx` |

Review persistence and retrieval are covered by `apps/api/test/integration/reviews.test.ts`: normalized fields, fractional ratings, per-target reads, inserted counts, prior-review preservation, partial results, transaction rollback, and cascade deletion. `apps/api/test/integration/cross-user-authorization.test.ts` covers owner positive controls, anonymous/cross-user/malformed/missing-target denial, no denied-request side effects, and review isolation. The former review-storage TODOs are implemented in this snapshot.

The workspace checks in `apps/web/src/features/workspace/pages/TargetWorkspacePage.test.tsx` cover the per-run saved count, the “Collection stopped early” warning, friendly failure messages, and refreshing latest-run state after a failed POST without presenting an older success as the new attempt.

Use these deterministic tests for provider-failure evidence. Do not exhaust a real quota, invalidate shared credentials, or substitute fixture reviews into the running app to stage a failure or success.

## Rehearse the current flow

Start `npm run dev` in a separate terminal. Open <http://localhost:5173>; the public health endpoint is <http://localhost:3000/api/health>. A healthy response confirms the API is responding, not that sign-in or database operations work.

1. Open `/analysis-targets` while signed out. Sign in as User A and verify the return to the protected page.
2. Open `/analysis-targets/new` and create a clearly named rehearsal target using a real, supported Google Maps place URL. See [supported source URLs](ingestion-approach.md#supported-source-urls). Follow the creation confirmation into its workspace. Confirm the target name, platform and source. Check the target list and recent-target entry links, then refresh to verify persistence.
3. In a separate browser profile, sign in as User B and create a different target. Verify that lists stay separate and that opening User A's workspace as User B shows no target details. Keep target IDs only in local demo notes.
4. As User A, open the target workspace and start one bounded ingestion. Agree on the place and review cap first: real SerpApi calls spend searches. Do not repeat clicks or start parallel runs. Check the returned state and count, then reload the workspace and verify the persisted latest-run state. The displayed count means rows saved by that latest run, not all reviews stored for the target. To verify actual saved text and ratings, use the review GET endpoint in step 5; the workspace has no review-content list.
5. If authenticated API rehearsal is available, check the routes below using the signed-in browser's existing Network request context and request editor where available. Keep authentication inside that browser; never print or paste tokens into terminal commands, screenshots, PRs or transcripts. Use `GET /api/analysis-targets/:targetId/reviews` before and after reload to verify saved text, ratings, and target IDs. The response lists all stored reviews for that target; record counts and non-sensitive pass/fail observations without copying review content into shared notes. If this workflow is unavailable, retain automated evidence and mark live API checks blocked.
6. Sign out and verify protected content disappears. Present verified results and blockers in the order required by the course rubric.

| Route                                                       | Current behavior to verify                                                                                                           |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/session`                                          | Signed-in session accepted; anonymous request returns `401`                                                                          |
| `POST /api/analysis-targets`                                | Creates a target owned by the authenticated user                                                                                     |
| `GET /api/analysis-targets`                                 | Lists only that user's targets                                                                                                       |
| `GET /api/analysis-targets/recent`                          | Lists up to five of that user's newest targets                                                                                       |
| `GET /api/analysis-targets/:targetId`                       | Returns the owner's target; missing or another user's target returns `404`                                                           |
| `DELETE /api/analysis-targets/:targetId`                    | Owner deletion returns `204`; denied deletion leaves the target unchanged. Use only a disposable rehearsal target                    |
| `POST /api/analysis-targets/:targetId/ingestion-runs`       | Empty body starts ingestion for the owner's stored source URL; returns `201` with the completed run                                  |
| `GET /api/analysis-targets/:targetId/ingestion-runs/latest` | Returns the owner's latest persisted run, or `null` if no run exists; inaccessible target returns `404`                              |
| `GET /api/analysis-targets/:targetId/reviews`               | Returns the owner's stored review rows, or `[]` for an empty owned target; missing, malformed or another user's target returns `404` |

For ownership evidence, first prove User A can access the same target that User B is denied. Verify `404 NOT_FOUND` for cross-user target read/delete, ingestion read/start, and review retrieval, and `401` anonymously. Integration tests additionally verify that denied ingestion creates no run or reviews and never calls the provider; denied deletion leaves the owner's target and child rows intact. They also verify User B's review list never contains User A's reviews.

| Outcome                                              | Stored/API result and workspace behavior                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Full success                                         | `201`, `succeeded`, `errorCode: null`; `reviewCount` is the number of rows inserted in this run, shown as “reviews saved in this run.”                                                                                                                                                                              |
| Partial collection                                   | A later provider page fails but usable reviews remain: `201`, `succeeded`, a non-null `errorCode`, and the inserted count. The workspace shows “Collection stopped early” with a friendly reason.                                                                                                                   |
| Handled source/provider failure or no usable reviews | `201`, `failed`, a reason code and zero reviews for this run. Earlier saved reviews remain.                                                                                                                                                                                                                         |
| Persistence failure                                  | The insert/finish transaction rolls back; the service attempts to record `failed`, `PERSISTENCE_ERROR`, and zero, then returns a generic `500`. If the database is unavailable, even recording the failure may fail. The workspace refreshes latest-run state and avoids treating an older success as this attempt. |

A `succeeded` run without a warning still does not mean every review at the place was fetched: collection can stop at the configured cap. Re-ingestion appends rows; there is no deduplication constraint on `sourceReviewId`. Repeating the same import can therefore store duplicate reviews. The review GET returns all target rows, while the workspace shows only the latest run's saved count. See [paging and the review cap](ingestion-approach.md#paging-and-the-review-cap). Use deterministic tests for failure evidence rather than exhausting quota or replacing failures with sample reviews.

- [ ] Real Clerk sign-in, return navigation and sign-out pass.
- [ ] User A and User B create and retain distinct targets; lists and workspaces stay isolated.
- [ ] Owner, anonymous, missing/malformed ID and cross-user target read/delete, ingestion read/start, and review retrieval are verified. Owner success on the same target provides the positive control.
- [ ] Workspace links, initial state, ingestion action, safe failures and latest-run state after reload are verified live.
- [ ] Real owner ingestion returns an honestly recorded full, partial or failed outcome; the saved count and any warning agree with the run response.
- [ ] The review GET returns saved normalized text/ratings after reload, associated with the correct target and inaccessible to another account. Review-content inspection requires the API; it is not shown in the workspace.

## Current scope and remaining checks

The current schema has four application models/tables: `User`/`users`, `AnalysisTarget`/`analysis_targets`, `IngestionRun`/`ingestion_runs`, and `Review`/`reviews`. A user owns targets; each target owns its runs and reviews. Deleting a target cascades to those children. The third migration, `20261109120000_reviews`, adds review storage and `PERSISTENCE_ERROR`.

Normalization filters unusable text/ratings before saving. The review repository inserts the batch and marks its running ingestion attempt succeeded in one transaction; `reviewCount` comes from the inserted-row count. Review reads check ownership in the service and scope by owner in SQL. See the [repository file guide](repository-file-guide.md) for the implementation map.

The earlier integration dependencies are merged. Remaining rehearsal work is verification on the chosen demo revision:

- Run the quality gates with all database suites enabled and record the exact revision and results.
- Verify two real Clerk accounts, separate target lists, owner review retrieval, cross-user denial, and persistence after reload.
- Verify the workspace's current saved-count and outcome messages; use tests for deterministic failures and partial results.
- Run a separate multi-page import only when the chosen cap and provider quota permit it. Repeated imports can duplicate stored reviews.
- Verify required CI check enforcement independently of green workflow results.

## Historical local verification

The following results were recorded before this refresh and apply only to the listed revisions. They were not rerun for `b0d120b` as part of this documentation update. Checks ran on macOS with Node 26.5.0, unchanged locked dependencies, and PostgreSQL 17 in the dedicated `reviewlens_test` database. The guide recommends the project's Node 24. Windows instructions were reviewed, not executed on Windows.

| Exact revision                                                         | Existing test results                                         | Other checks                                                                  |
| ---------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Historical main `6f79e84`, recorded at 12:35 p.m. Eastern**          | **192 passed: shared 13, API 126, web 53; no skips or TODOs** | **Lint, formatting, typecheck and build passed**                              |
| Earlier #43 head `89ff5f2`, including #42                              | 192 passed; no skips or TODOs                                 | All five gates passed; same code tree as `6f79e84`                            |
| #41 `fef5574`, checked separately                                      | 192 passed; 3 review-storage TODOs remain                     | Lint, formatting, typecheck and build passed                                  |
| Earlier temporary local combination of #43 and normalization `549d765` | 221 passed; no skips or TODOs                                 | Lint, typecheck and build passed; formatting failed in five changed API files |

The temporary combination was not committed or published. Its formatting failures are in `ingestion.service.test.ts`, `review-normalizer.test.ts`, `review-normalizer.ts`, `test/helpers/test-database.ts` and `test/integration/ingestion.test.ts`. At that earlier check, Jonathan's branch had advanced to `af07afb` with comments only; the historical combination's results were not rerun on that tip. These findings do not describe current main.

A historical component probe at `6f79e84` rendered otherwise identical `succeeded` runs with `errorCode: null` and `errorCode: PROVIDER_TIMEOUT`. The visible text was identical, so the distinction assertion failed separately from the existing-test counts above. PR #48 adds the warning and a component test in current source; that historical failure is not a new test result for `b0d120b`.

### Live rehearsal, November 9, around 7:00 p.m. Eastern

The API and web configuration validated successfully after a personal SerpApi key was configured privately. These checks used real services on unchanged main `6f79e84`:

- [x] API health returned `200`.
- [x] The backend accepted an existing real Clerk Google session.
- [x] A target was created through the UI, appeared in the owner's list and opened in its workspace.
- [x] One real SerpApi import with `MAX_REVIEWS_PER_RUN=1` succeeded. A read-only database check confirmed status `succeeded`, `error_code: null` and `review_count: 1`.
- [x] Reloading the workspace retained the run state and count. List-to-workspace links worked.
- [x] After sign-out, opening the workspace directly redirected to sign-in. An anonymous API target GET returned `401`.
- [ ] Live isolation between two separate accounts.
- [ ] A separate multi-page provider import.
- [ ] Saved review text/ratings after the team's storage work is integrated.
- [ ] A visible warning for partial results after the workspace defect is fixed.

This rehearsal verifies a successful single-page import and persisted run information. The recorded count does not establish saved review text or ratings. The automated tests above separately cover controlled identities and recorded provider responses.

This historical rehearsal did not inspect saved review content: review storage was not present at `6f79e84`. Do not use it as live acceptance evidence for the later storage, authorization or result-reporting changes.

## Repeat or recover safely

- Reuse the separate browser profiles and existing rehearsal targets when appropriate. Creating or ingesting again can add records, duplicate existing reviews, or spend more provider searches.
- There is no `npm run db:reset` script in the current root package. Do not use an assumed reset command to prepare the demo. If a clean target is needed, create a new clearly named target; delete only a disposable owned rehearsal target when its removal is intended.
- After editing environment files, restart `npm run dev`. For configuration failures, follow the named variables in the startup message without printing their values.
- If PostgreSQL is unavailable, confirm Docker is running and the configured port is available, then retry `npm run db:up`. Preserve migration failures for investigation; do not reset the database to hide them.
- Stop the apps with Ctrl+C, stop the test database with `npm run db:test:down`, and stop local database containers with `npm run db:down` when finished. Existing Docker volumes retain data. Do not remove volumes, run database resets, or point tests at demo data as part of rehearsal recovery.

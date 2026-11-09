# Demo setup and rehearsal

Use this checklist to prepare a local demo and record what actually passes. Follow the course rubric for the presentation order and required evidence. An unchecked item is unverified; mark missing functionality as blocked rather than presenting planned behavior as complete.

**Current checked main:** [`6f79e84`](https://github.com/NFurman0/CS490_Project/commit/6f79e846d0fe2e5ec3f70a5a5d514f488b5362fe), November 9, 2026, 12:35 p.m. Eastern. PRs #42 and #43 are merged. The workspace and target-ownership routes below are now on main; review storage and live service verification remain incomplete.

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

Check each result before continuing. If a check fails, preserve the failure and stop the test database when finished investigating. `npm test` can pass while database suites are skipped if no test database is configured. Confirm that the persistence, ownership, and ingestion database suites ran; skipped suites are not acceptance evidence.

- [ ] Lint, formatting, typecheck, tests, and build pass on the revision being demonstrated.
- [ ] Database suites ran against the isolated database with no skips.
- [ ] Record the revision, commands, results, and any blockers in the PR or demo notes without credentials or private review content.

The existing acceptance tests are:

| Evidence                                                                                          | Existing test file                                                                                                                  |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Authentication and anonymous rejection                                                            | `apps/api/test/integration/auth.test.ts`                                                                                            |
| Target creation, persistence, owner-only lists, read/delete ownership, input validation           | `apps/api/test/integration/analysis-targets-persistence.test.ts`                                                                    |
| Identity mapping and server-assigned ownership                                                    | `apps/api/test/integration/ownership.test.ts`                                                                                       |
| Ingestion owner success, latest-run reads, anonymous/cross-user denial, stored failed-run outcome | `apps/api/test/integration/ingestion.test.ts`                                                                                       |
| Provider failures, timeouts, pagination, caps, and safe logging                                   | `apps/api/src/adapters/serpapi/serpapi-review-source.test.ts`                                                                       |
| All ingestion failure codes and partial results                                                   | `apps/api/src/modules/ingestion/ingestion.service.test.ts`                                                                          |
| Sign-in protection and logout behavior                                                            | `apps/web/src/app/App.test.tsx`                                                                                                     |
| Creation feedback and target-list states                                                          | `apps/web/src/features/targets/pages/CreateTargetPage.test.tsx`, `apps/web/src/features/workspace/pages/WorkspaceHomePage.test.tsx` |

The current workspace component checks are in `apps/web/src/features/workspace/pages/TargetWorkspacePage.test.tsx`; they cover target details, successful/failed ingestion, denied access and safe loading/network failures. They do not cover the partial-result warning defect described below.

Use these deterministic tests for provider-failure evidence. Do not exhaust a real quota, invalidate shared credentials, or substitute fixture reviews into the running app to stage a failure or success.

## Rehearse the current flow

Start `npm run dev` in a separate terminal. Open <http://localhost:5173>; the public health endpoint is <http://localhost:3000/api/health>. A healthy response confirms the API is responding, not that sign-in or database operations work.

1. Open `/analysis-targets` while signed out. Sign in as User A and verify the return to the protected page.
2. Open `/analysis-targets/new` and create a clearly named rehearsal target using a real, supported Google Maps place URL. See [supported source URLs](ingestion-approach.md#supported-source-urls). Follow the creation confirmation into its workspace. Confirm the target name, platform and source. Check the target list and recent-target entry links, then refresh to verify persistence.
3. In a separate browser profile, sign in as User B and create a different target. Verify that lists stay separate and that opening User A's workspace as User B shows no target details. Keep target IDs only in local demo notes.
4. As User A, open the target workspace and start one bounded ingestion. Agree on the place and review cap first: real SerpApi calls spend searches. Do not repeat clicks or start parallel runs. Check the returned state and count, then reload the workspace and verify the persisted latest-run state. This verifies saved run information, not saved review content.
5. If authenticated API rehearsal is available, check the routes below using the signed-in browser's existing Network request context and request editor where available. Keep authentication inside that browser; never print or paste tokens into terminal commands, screenshots, PRs or transcripts. If this workflow is unavailable, retain automated evidence and mark live API checks blocked.
6. Sign out and verify protected content disappears. Present verified results and blockers in the order required by the course rubric.

| Route                                                       | Current behavior to verify                                                                                        |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `GET /api/session`                                          | Signed-in session accepted; anonymous request returns `401`                                                       |
| `POST /api/analysis-targets`                                | Creates a target owned by the authenticated user                                                                  |
| `GET /api/analysis-targets`                                 | Lists only that user's targets                                                                                    |
| `GET /api/analysis-targets/recent`                          | Lists up to five of that user's newest targets                                                                    |
| `GET /api/analysis-targets/:targetId`                       | Returns the owner's target; missing or another user's target returns `404`                                        |
| `DELETE /api/analysis-targets/:targetId`                    | Owner deletion returns `204`; denied deletion leaves the target unchanged. Use only a disposable rehearsal target |
| `POST /api/analysis-targets/:targetId/ingestion-runs`       | Empty body starts ingestion for the owner's stored source URL; returns `201` with the completed run               |
| `GET /api/analysis-targets/:targetId/ingestion-runs/latest` | Returns the owner's latest persisted run, or `null` if no run exists; inaccessible target returns `404`           |

For ownership evidence, first prove User A can access the same target that User B is denied. Verify `404 NOT_FOUND` for cross-user target read/delete and ingestion read/start, and `401` anonymously. Existing integration tests additionally prove that denied ingestion creates no run and never calls the provider; a denied delete leaves the owner's target intact. The target-detail GET route now exists, so the old missing-route caveat at `4f24794` no longer applies.

A handled provider failure before any reviews are collected returns `201` with a `failed` run, an `errorCode`, and zero reviews. If a later page fails after reviews were collected, the run returns `201` with `succeeded`, the collected count, and an `errorCode` warning. See [paging and the review cap](ingestion-approach.md#paging-and-the-review-cap). **Current main does not display that partial-result warning in the workspace.** Inspect the run body where available; do not present the screen's “Succeeded” label alone as proof of a complete import. Use deterministic tests for failure evidence rather than exhausting quota or replacing failures with sample reviews.

- [ ] Real Clerk sign-in, return navigation and sign-out pass.
- [ ] User A and User B create and retain distinct targets; lists and workspaces stay isolated.
- [ ] Owner, anonymous, missing/malformed ID and cross-user target read/delete and ingestion read/start are verified. Owner success on the same target provides the positive control.
- [ ] Workspace links, initial state, ingestion action, safe failures and latest-run state after reload are verified live.
- [ ] Real owner ingestion returns an honestly recorded full, partial or failed outcome. The partial-result display defect is resolved before claiming that reporting works.
- [ ] Normalized text/ratings are saved and retrievable after reload, belong to the correct target and remain inaccessible to another account. This is currently blocked by missing storage.

## Current scope and remaining dependencies

At `6f79e84`, main includes the workspace screen, target read/delete ownership checks, ingestion controls and latest-run reads from merged [#42](https://github.com/NFurman0/CS490_Project/pull/42) and [#43](https://github.com/NFurman0/CS490_Project/pull/43). Their merges are no longer a pending dependency. Main is byte-identical to the previously tested #43 head `89ff5f2`.

The backend persists ingestion-run status, timestamps, errors and the fetched count. It still does not normalize or save actual `Review` text/ratings. A persisted run summary is not persisted reviews.

| Remaining work                                                                                                                                            | Current evidence                                                                | Acceptance gate                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| [#41 — review/ingestion authorization](https://github.com/NFurman0/CS490_Project/pull/41), `fef5574`                                                      | Open and conflicting with current main; three review-storage tests remain TODOs | Reconcile ownership helpers while retaining main's target GET/DELETE and latest-run routes; complete storage-dependent tests |
| [#21 — normalization](https://github.com/NFurman0/CS490_Project/issues/21), Jonathan's `549d765` branch                                                   | Counts usable normalized records but does not save them                         | Integrate reviewed normalization, resolve the observed formatting failures and test malformed-record behavior                |
| [#22 — review storage](https://github.com/NFurman0/CS490_Project/issues/22) and [#23 — result state](https://github.com/NFurman0/CS490_Project/issues/23) | Assigned to Jonathan and still open at this check                               | Persist and retrieve real review content, verify ownership, and report outcomes/counts with accurate meaning                 |
| Live service configuration                                                                                                                                | Local Clerk/SerpApi values remain placeholders                                  | Install valid matching development configuration privately, then complete the live two-account rehearsal                     |

A read-only merge simulation of #41 against current main finds conflicts in `ingestion.routes.ts`, `ingestion.service.ts`, `targets.service.ts` and `targets.service.test.ts`. The owners must reconcile the differing helper signatures and preserve the new endpoints. No combined #41/current-main revision has passed verification.

When storage is available, replace #41's three TODOs with passing checks: cross-user review retrieval is denied, denied ingestion creates no reviews, and Target B retrieval never returns Target A's reviews. Do not count TODOs or skipped cases as coverage. After each relevant integration, record the exact revision, rerun affected quality gates and repeat the live rehearsal.

## Recorded local verification

Checks ran on macOS with Node 26.5.0, unchanged locked dependencies, and PostgreSQL 17 in the dedicated `reviewlens_test` database. The guide recommends the project's Node 24. Windows instructions were reviewed, not executed on Windows.

| Exact revision                                                         | Existing test results                                         | Other checks                                                                  |
| ---------------------------------------------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Current main `6f79e84`, freshly checked at 12:35 p.m. Eastern**      | **192 passed: shared 13, API 126, web 53; no skips or TODOs** | **Lint, formatting, typecheck and build passed**                              |
| Earlier #43 head `89ff5f2`, including #42                              | 192 passed; no skips or TODOs                                 | All five gates passed; same code tree as current main                         |
| #41 `fef5574`, checked separately                                      | 192 passed; 3 review-storage TODOs remain                     | Lint, formatting, typecheck and build passed                                  |
| Earlier temporary local combination of #43 and normalization `549d765` | 221 passed; no skips or TODOs                                 | Lint, typecheck and build passed; formatting failed in five changed API files |

The temporary combination was not committed or published. Its formatting failures are in `ingestion.service.test.ts`, `review-normalizer.test.ts`, `review-normalizer.ts`, `test/helpers/test-database.ts` and `test/integration/ingestion.test.ts`.

A separate component probe was rerun on current main: render otherwise identical `succeeded` runs first with `errorCode: null`, then with `errorCode: PROVIDER_TIMEOUT`. The visible workspace text is identical. The assertion that the user can distinguish those outcomes **fails**. This additional failing probe is separate from the passing existing-test counts above. The workspace needs a partial-result warning.

The local configuration was rechecked and remains placeholders. Earlier actual API startup stopped at configuration validation, while the web configuration-error screen loaded. Real sign-in, two-account isolation and live ingestion remain unverified. Automated tests use fake identities and recorded provider responses; they do not establish service access.

These results do not approve or merge a pending feature PR. Recheck current source state before treating any blocker as resolved.

## Repeat or recover safely

- Reuse the separate browser profiles and existing rehearsal targets when appropriate. Creating or ingesting again can add records or spend more provider searches.
- After editing environment files, restart `npm run dev`. For configuration failures, follow the named variables in the startup message without printing their values.
- If PostgreSQL is unavailable, confirm Docker is running and the configured port is available, then retry `npm run db:up`. Preserve migration failures for investigation; do not reset the database to hide them.
- Stop the apps with Ctrl+C, stop the test database with `npm run db:test:down`, and stop local database containers with `npm run db:down` when finished. Existing Docker volumes retain data. Do not remove volumes, run database resets, or point tests at demo data as part of rehearsal recovery.

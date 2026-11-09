# Demo setup and rehearsal

Use this checklist to prepare a local demo and record what actually passes. Follow the course rubric for the presentation order and required evidence. An unchecked item is unverified; mark missing functionality as blocked rather than presenting planned behavior as complete.

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

| Evidence                                                                                              | Existing test file                                                                                                                  |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Authentication and anonymous rejection                                                                | `apps/api/test/integration/auth.test.ts`                                                                                            |
| Target creation, persistence, owner-only lists, input validation                                      | `apps/api/test/integration/analysis-targets-persistence.test.ts`                                                                    |
| Identity mapping and server-assigned ownership                                                        | `apps/api/test/integration/ownership.test.ts`                                                                                       |
| Ingestion owner success, anonymous/cross-user denial before provider calls, stored failed-run outcome | `apps/api/test/integration/ingestion.test.ts`                                                                                       |
| Provider failures, timeouts, pagination, caps, and safe logging                                       | `apps/api/src/adapters/serpapi/serpapi-review-source.test.ts`                                                                       |
| All ingestion failure codes and partial results                                                       | `apps/api/src/modules/ingestion/ingestion.service.test.ts`                                                                          |
| Sign-in protection and logout behavior                                                                | `apps/web/src/app/App.test.tsx`                                                                                                     |
| Creation feedback and target-list states                                                              | `apps/web/src/features/targets/pages/CreateTargetPage.test.tsx`, `apps/web/src/features/workspace/pages/WorkspaceHomePage.test.tsx` |

Use these deterministic tests for provider-failure evidence. Do not exhaust a real quota, invalidate shared credentials, or substitute fixture reviews into the running app to stage a failure or success.

## Rehearse the current flow

Start `npm run dev` in a separate terminal. Open <http://localhost:5173>; the public health endpoint is <http://localhost:3000/api/health>. A healthy response confirms the API is responding, not that sign-in or database operations work.

1. Open `/analysis-targets` while signed out. Sign in as User A and verify the return to the protected page.
2. Open `/analysis-targets/new` and create a clearly named rehearsal target using a real, supported Google Maps place URL. See [supported source URLs](ingestion-approach.md#supported-source-urls). Confirm the success message and that the target remains in `/analysis-targets` after a refresh.
3. In a separate browser profile, sign in as User B and create a different target. Verify that each user's list contains their own target and excludes the other user's target. Keep their target IDs available only in local demo notes.
4. If authenticated API rehearsal is available, verify the actual routes below. For request inspection or replay, use the signed-in browser's existing Network request context and request editor where available. Keep authentication inside that browser; never print or paste session tokens into terminal commands, history, screenshots, PRs, or AI transcripts. If that workflow is unavailable, mark the live API check blocked and retain the automated evidence.
5. Sign out and verify protected content disappears. Finish with the verified results and remaining blockers, in the order required by the course rubric.

| Route                                                 | Current behavior to verify                                                                          |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `GET /api/session`                                    | Signed-in session accepted; anonymous request returns `401`                                         |
| `POST /api/analysis-targets`                          | Creates a target owned by the authenticated user                                                    |
| `GET /api/analysis-targets`                           | Lists only that user's targets                                                                      |
| `GET /api/analysis-targets/recent`                    | Lists up to five of that user's newest targets                                                      |
| `POST /api/analysis-targets/:targetId/ingestion-runs` | Empty body starts ingestion for the owner's stored source URL; returns `201` with the completed run |

For live API isolation evidence, request User A's ingestion route as User B and expect `404 NOT_FOUND`; repeat anonymously and expect `401`. The existing integration test additionally proves that rejected requests create no run and never call the provider. **There is no target-detail GET route at the baseline below.** A `404` from `GET /api/analysis-targets/:targetId` does not prove ownership enforcement.

A successful owner ingestion uses the real SerpApi key and spends searches. Agree on the place and review cap before running it; avoid repeated clicks or parallel runs. See [paging and the review cap](ingestion-approach.md#paging-and-the-review-cap). A handled source/provider failure before any reviews are collected returns `201` with a `failed` run, an `errorCode`, and zero reviews. If a later page fails after reviews were collected, the run returns `201` with `succeeded`, the collected count, and an `errorCode` warning. Inspect the run body, not just the HTTP status, and identify partial results as partial. The app must never replace a failure with sample reviews.

- [ ] Real Clerk sign-in, return navigation, and sign-out pass.
- [ ] User A and User B each create and retain a distinct target; lists remain isolated.
- [ ] Cross-user and anonymous ingestion denial are verified, with automated no-side-effect evidence.
- [ ] If exercised, real owner ingestion returns the expected run outcome; record it honestly.
- [ ] Required target workspace, ingestion controls, and status display are demonstrated, or recorded as blocked if missing.
- [ ] Required normalized and saved reviews are verified, or recorded as blocked if missing. A fetched count alone does not prove review storage.

### Known baseline scope

At `4f24794`, the frontend routes are target creation and the target list. There is no target detail/workspace or ingestion/status UI. The backend implements the routes above and persists ingestion-run outcomes, but fetched reviews are counted rather than normalized and saved as `Review` records. These are baseline observations, not claims that the related team work is finished. Recheck the actual demo revision before changing any blocked item to passed.

### Pending integration: November 9, 2026, 10:48 a.m. Eastern

`main` is still `4f24794`. The three PRs below are open and unmerged; each has passing CI and no submitted reviews at this check. These results apply to their own revisions, not to a combined demo build.

| Pending work                                                                              | Inspected revision and dependency                                                                                        | Demo implication                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [#41 — review/ingestion authorization](https://github.com/NFurman0/CS490_Project/pull/41) | `fef5574`, based on `main`                                                                                               | Adds a shared ownership helper and authorization tests. Review-data cases remain TODOs until storage exists.                                                                                                       |
| [#42 — target authorization](https://github.com/NFurman0/CS490_Project/pull/42)           | `0a094bd`, based on `main`                                                                                               | Adds owned target GET and DELETE routes. The detail-route caveat above remains true on current `main`.                                                                                                             |
| [#43 — target workspace](https://github.com/NFurman0/CS490_Project/pull/43)               | `89ff5f2`, based on #42's branch                                                                                         | Adds workspace navigation, ingestion controls, and latest-run reads. Review after #42 and recheck its base after #42 merges, as the PR requests. Its displayed count is fetched reviews, not saved review content. |
| [#21 — normalization](https://github.com/NFurman0/CS490_Project/issues/21)                | Jonathan's [`549d765`](https://github.com/NFurman0/CS490_Project/commit/549d765df992a77349ee72ffe5e7bc7017dddb54) branch | Converts raw records into usable reviews and counts them, but still does not save their text/ratings. [#22 — review storage](https://github.com/NFurman0/CS490_Project/issues/22) remains open.                    |

#41 and #43 both change `ingestion.routes.ts` and `ingestion.service.ts`, including ownership checks. #41 and #42 also overlap in `targets.service.ts` and its tests. The normalization branch changes the ingestion service too. Individually passing checks do not establish that these changes work together. Have the feature owners reconcile the overlaps, then rehearse a reviewed integrated revision.

After the team supplies the integrated revision, rerun the quality gates above and complete these additional checks. These are **pending**, not results from the earlier baseline tests:

- [ ] Record the exact integrated commit and confirm which PRs are included. Confirm #43's target-read dependency is present and that overlapping ownership changes were reconciled.
- [ ] Run owner, anonymous, missing/malformed ID, and different-user tests for target GET/DELETE and latest-run GET. Prove an owner succeeds on the same target used for denied requests. A denied delete must leave the owner's target unchanged; any successful delete demonstration uses a disposable rehearsal target.
- [ ] Rerun ingestion denial checks after integration: no run creation, no provider call, no review changes, and no leaked target data for an unauthorized request.
- [ ] Open the workspace through the list, recent targets and create confirmation. Check target identity, initial state, import action, error behavior, and latest-run state after a page reload. Saved run status is separate from saved review content.
- [ ] Exercise full success, complete failure and partial success with deterministic tests. A succeeded run with an `errorCode` must not be presented as an unrestricted success; #43's inspected screen does not display that warning, so this needs review before claiming partial-result reporting works.
- [ ] Once #21 and #22 are integrated, verify valid normalized text/ratings are actually retrievable after reload, belong to the right target, and remain inaccessible to another account. Verify malformed-record handling and that the reported count matches its stated meaning. A raw or normalized count alone does not pass storage acceptance.
- [ ] Once storage exists, verify that the three TODOs in #41's `cross-user-authorization.test.ts` have become passing tests: cross-user review retrieval denied, denied ingestion creates no reviews, and Target B retrieval never returns Target A's reviews. Do not count TODO/skipped cases as coverage. Real Clerk/SerpApi configuration and live rehearsal remain separate requirements from CI.

## Repeat or recover safely

- Reuse the separate browser profiles and existing rehearsal targets when appropriate. Creating or ingesting again can add records or spend more provider searches.
- After editing environment files, restart `npm run dev`. For configuration failures, follow the named variables in the startup message without printing their values.
- If PostgreSQL is unavailable, confirm Docker is running and the configured port is available, then retry `npm run db:up`. Preserve migration failures for investigation; do not reset the database to hide them.
- Stop the apps with Ctrl+C, stop the test database with `npm run db:test:down`, and stop local database containers with `npm run db:down` when finished. Existing Docker volumes retain data. Do not remove volumes, run database resets, or point tests at demo data as part of rehearsal recovery.

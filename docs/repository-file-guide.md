# ReviewLens Repository File Guide

Short descriptions of all **140 tracked files** in [NFurman0/CS490_Project](https://github.com/NFurman0/CS490_Project), grouped by directory.

**Snapshot:** `main` at [`a2b935a27ccdbae708a4758a2a89c5e9dbc64325`](https://github.com/NFurman0/CS490_Project/tree/a2b935a27ccdbae708a4758a2a89c5e9dbc64325), inspected November 10, 2026. This guide describes the code at that commit, including review normalization from PR #45.

**Scope:** The complete repository, with database-related files marked **DB**. Generated output, installed dependencies, Git internals, private `.env` files, and this new guide are excluded from the 140-file count. No live database records were queried.

## Database at a glance

- **PostgreSQL + Prisma:** PostgreSQL stores the data; Prisma defines the models and provides the TypeScript database client.
- **Three application tables:** `users` maps Clerk identities to internal user IDs; `analysis_targets` stores each user's named Google Maps source; `ingestion_runs` stores an attempt's status, error code, usable-review count, and timestamps.
- **Relationships:** One user owns many targets; one target has many ingestion runs. Foreign keys use cascading deletes.
- **Review content is not stored yet:** The current ingestion service fetches and normalizes reviews, then saves the run metadata. There is no `Review` model or review-content migration. `reviewCount` is a count of usable reviews, not saved review rows.
- **Authorization:** Target repository queries include the authenticated owner's ID. Ingestion checks target ownership before accessing its runs.
- **Run outcomes:** A succeeded run can still contain an error code if a later provider page fails but usable reviews remain. Ingestion runs inside the POST request, not in a background job.

Start with `apps/api/prisma/schema.prisma`, the two migration files, `apps/api/src/lib/prisma.ts`, and the three `*.repository.ts` files. Database setup is in `docker-compose.yml` and the package scripts; database test protection is in `apps/api/test/helpers/test-database.ts`.

**DB** below means a file directly defines, configures, accesses, or tests database persistence. Other files may use the API without accessing the database directly.

## Root: setup and shared tooling

- `README.md`: Project overview, installation steps, local commands, authentication setup, and links to team documentation.
- `Sprint1Issues.csv`: Sprint 1 issue definitions, including story IDs, descriptions, labels, and sprint information for the import workflow.
- `docker-compose.yml` **DB**: Defines separate PostgreSQL 17 development and test services, ports, health checks, and persistent volumes.
- `package.json` **DB**: Defines npm workspaces and root commands for development, checks, builds, Prisma generation, migrations, and database containers.
- `package-lock.json`: Locks dependency versions and integrity metadata for reproducible npm installs across the workspaces.
- `tsconfig.base.json`: Shared strict TypeScript compiler settings inherited by the API, web app, and shared package.
- `eslint.config.js`: Repository lint rules, including TypeScript, React hooks, Node/browser globals, and restrictions on unsafe types and API console logging.
- `.gitignore`: Excludes dependencies, build output, private environment files, logs, and local editor files from Git.
- `.nvmrc`: Selects Node.js 24 for developers and CI.
- `.prettierignore`: Excludes generated content, the lockfile, sprint CSV, transcripts, and documentation from normal Prettier checks.
- `.prettierrc.json`: Sets shared formatting preferences such as single quotes, semicolons, trailing commas, and line width.

## `.github/`: pull requests and automation

- `.github/pull_request_template.md`: Standard PR sections for the story, change summary, test evidence, and security/ownership impact.
- `.github/workflows/ci.yml` **DB**: Runs lint/format, typecheck, build, and tests; provisions test PostgreSQL and applies migrations for database tests.
- `.github/workflows/import-sprint-issues.yml`: Manually triggered CSV-to-GitHub issue importer with dry-run mode, label creation, and duplicate-title checks.

## `.vscode/`: editor recommendations

- `.vscode/extensions.json`: Recommends the ESLint and Prettier VS Code extensions.

## `apps/api/`: backend configuration

- `apps/api/.env.example` **DB**: Template for server configuration, including the database URL, Clerk and SerpApi settings, review cap, and logging level.
- `apps/api/.env.test.example` **DB**: Template pointing integration tests at the dedicated `reviewlens_test` database on local port 5433.
- `apps/api/package.json` **DB**: API dependencies and commands for server development, compilation, tests, Prisma, migrations, and fixture recording.
- `apps/api/tsconfig.json`: Type-checks API source, tests, scripts, and Vitest configuration using the shared strict settings.
- `apps/api/tsconfig.build.json`: Compiles production API source into `dist`, excluding test files and using Node-compatible module resolution.
- `apps/api/vitest.config.ts` **DB**: Configures Node-based tests and shared-source imports; runs test files serially because database suites share resettable tables.

## `apps/api/prisma/`: database schema and migrations

- `apps/api/prisma/schema.prisma` **DB**: Defines the PostgreSQL datasource, Prisma client, enums, and `User`, `AnalysisTarget`, and `IngestionRun` models and relationships.
- `apps/api/prisma/migrations/20261107204400_init/migration.sql` **DB**: Creates users and targets, the review-platform enum, ownership foreign key, indexes, and nonempty-field constraints.
- `apps/api/prisma/migrations/20261108120000_ingestion_runs/migration.sql` **DB**: Creates ingestion runs and outcome enums, linking runs to targets and enforcing counts, failed-run error codes, and completion timestamps.

## `apps/api/scripts/`: developer utilities

- `apps/api/scripts/migrate-test-db.mjs` **DB**: Loads the test environment when present and runs Prisma migration deployment against its configured database URL.
- `apps/api/scripts/record-serpapi-fixture.ts`: Fetches one live SerpApi review page, scrubs key-bearing fields, and saves a JSON fixture; running it consumes provider quota.

## `apps/api/src/`: application entry points

- `apps/api/src/app.ts`: Constructs Express with CORS, JSON parsing, request IDs, public health, protected API routes, and centralized errors; does not start listening.
- `apps/api/src/server.ts` **DB**: Loads configuration, wires Prisma repositories and external adapters into services/routes, starts the server, and disconnects Prisma on shutdown.

## `apps/api/src/config/`: environment validation

- `apps/api/src/config/env.ts` **DB**: Validates server settings, including the database URL and provider keys, and reports configuration problems without revealing secret values.
- `apps/api/src/config/env.test.ts`: Tests configuration defaults, missing/placeholder values, malformed Clerk keys, and secret-safe error messages.

## `apps/api/src/lib/`: backend building blocks

- `apps/api/src/lib/errors.ts`: Defines `AppError`, mapping known error codes to HTTP statuses and carrying a user-safe message supplied by the caller.
- `apps/api/src/lib/identity.ts`: Defines verified/authenticated identity interfaces, the user-directory contract, request typing, and the `currentUser` accessor.
- `apps/api/src/lib/logger.ts`: Creates the Pino logger with redaction paths for tokens, keys, database URLs, and provider request URLs.
- `apps/api/src/lib/prisma.ts` **DB**: Creates a Prisma client using the validated database connection URL supplied by the server.

## `apps/api/src/middleware/`: request handling

- `apps/api/src/middleware/error-handler.ts`: Converts known, validation, and unexpected errors into the standard API envelope and handles unmatched routes.
- `apps/api/src/middleware/request-id.ts`: Assigns a new UUID to each request for error responses and log correlation.
- `apps/api/src/middleware/require-user.ts`: Rejects unverified sessions, resolves an internal user through the user directory, and attaches trusted identity to the request.

## `apps/api/src/adapters/clerk/`: authentication provider

- `apps/api/src/adapters/clerk/clerk-identity-provider.ts`: Configures Clerk verification, exposes authenticated Clerk IDs, strips Clerk diagnostic headers, and logs safe rejection reasons.
- `apps/api/src/adapters/clerk/clerk-identity-provider.test.ts`: Tests Clerk configuration, authentication resolution, rejection logging, and diagnostic-header removal.

## `apps/api/src/adapters/serpapi/`: Google Maps review source

- `apps/api/src/adapters/serpapi/place-url.ts`: Extracts supported Google Maps place identifiers and resolves allowed short-link redirects with bounded hops and timeouts.
- `apps/api/src/adapters/serpapi/place-url.test.ts`: Tests accepted place URLs, encoded identifiers, country domains, short links, and unsupported or failed resolutions.
- `apps/api/src/adapters/serpapi/serpapi.client.ts`: Fetches one provider page and translates timeouts, HTTP errors, malformed responses, and quota failures into ingestion outcome codes.
- `apps/api/src/adapters/serpapi/serpapi.parser.ts`: Converts provider JSON into raw reviews, place details, and pagination tokens; classifies provider errors without database writes.
- `apps/api/src/adapters/serpapi/serpapi.parser.test.ts`: Tests review/metadata extraction, original-language text, recorded responses, malformed data, pagination, and provider-error classification.
- `apps/api/src/adapters/serpapi/serpapi-review-source.ts`: Implements the review-source interface, resolves the place, collects capped pages, and preserves partial results after later-page failures.
- `apps/api/src/adapters/serpapi/serpapi-review-source.test.ts`: Tests pagination, review caps, source/provider errors, partial results, empty pages, and secret-safe logging with fake network responses.

## `apps/api/src/modules/health/` and `session/`: basic endpoints

- `apps/api/src/modules/health/health.routes.ts`: Public `/api/health` liveness endpoint returning an `ok` status without querying the database.
- `apps/api/src/modules/session/session.routes.ts`: Protected `/api/session` endpoint confirming that the API accepted the caller's authenticated session.

## `apps/api/src/modules/users/`: internal user mapping

- `apps/api/src/modules/users/users.repository.ts` **DB**: Finds or creates the internal user for a Clerk identity, including recovery from concurrent first-request creation races.

## `apps/api/src/modules/targets/`: analysis targets

- `apps/api/src/modules/targets/targets.repository.ts` **DB**: Uses Prisma to create, list, find, and delete targets with owner-scoped queries and newest-first ordering.
- `apps/api/src/modules/targets/targets.service.ts`: Validates Google Maps sources, assigns the supported platform, limits recent targets to five, and enforces owned-target reads/deletes.
- `apps/api/src/modules/targets/targets.service.test.ts`: Tests source validation, platform assignment, owner scoping, and single-target read/delete behavior using a fake repository.
- `apps/api/src/modules/targets/targets.routes.ts`: Exposes target creation, full/recent lists, owned-target retrieval, and deletion; validates inputs and serializes API responses.

## `apps/api/src/modules/ingestion/`: collection and normalization

- `apps/api/src/modules/ingestion/ingestion-runs.repository.ts` **DB**: Creates, finishes, and finds the latest persisted ingestion run; callers must first verify ownership of the parent target.
- `apps/api/src/modules/ingestion/ingestion.routes.ts`: Exposes start-ingestion and latest-run endpoints under a target, validates UUIDs/body, and serializes run status and timestamps.
- `apps/api/src/modules/ingestion/ingestion.service.ts`: Verifies ownership, fetches and normalizes reviews, and records run outcomes/counts through the repository; does not save review content.
- `apps/api/src/modules/ingestion/ingestion.service.test.ts`: Tests ownership-first execution, review caps, normalized counts, provider failures, partial success, and unexpected errors using fake dependencies.
- `apps/api/src/modules/ingestion/review-source.ts`: Defines provider-independent raw reviews, place information, fetch results, and the injectable `ReviewSource` interface.
- `apps/api/src/modules/ingestion/review-normalizer.ts`: Trims and validates text, validates ratings without rounding, cleans optional fields, preserves metadata, and rejects batches without usable reviews.
- `apps/api/src/modules/ingestion/review-normalizer.test.ts`: Tests text/rating validity, fractional ratings, optional dates/URLs, record ordering, empty batches, and nonmutation of input data.

## `apps/api/test/helpers/`: test infrastructure

- `apps/api/test/helpers/test-app.ts`: Creates test Express apps with fake identity/user-directory implementations, a silent logger, and injectable feature routes.
- `apps/api/test/helpers/test-database.ts` **DB**: Configures test Prisma, requires the dedicated test database, checks the connected database before reset, and clears application rows.
- `apps/api/test/helpers/test-database.test.ts` **DB**: Tests acceptance of the dedicated test database URL and rejection of unsafe or malformed alternatives.
- `apps/api/test/helpers/serpapi-fixtures.ts`: Loads saved provider JSON and builds JSON `Response` objects for network-free adapter tests.

## `apps/api/test/integration/`: API and persistence tests

- `apps/api/test/integration/analysis-targets-persistence.test.ts` **DB**: Tests target persistence, constraints, creation/validation, owner-only reads/deletes, and full/recent listing against PostgreSQL.
- `apps/api/test/integration/app.test.ts`: Tests public health responses, missing routes, and safe formatting of application, validation, and unexpected errors.
- `apps/api/test/integration/auth.test.ts`: Tests session acceptance/rejection, default route protection, trusted identity, and rejection of spoofed identity headers.
- `apps/api/test/integration/ingestion.test.ts` **DB**: Tests ingestion HTTP routes, stored run outcomes/counts, latest-run retrieval, normalization effects, and unauthenticated/cross-user denial.
- `apps/api/test/integration/ownership.test.ts` **DB**: Tests persisted user mapping, concurrent first requests, separate identities, and ownership derived from authentication rather than client fields.
- `apps/api/test/integration/user-mapping.test.ts`: Tests identity-to-internal-user mapping and safe lookup failures using injected user directories rather than a live database.

## `apps/api/test/fixtures/serpapi/`: saved test inputs

These files are test inputs, not the application's database or fallback production review data.

- `apps/api/test/fixtures/serpapi/README.md`: Explains each fixture, synthetic versus recorded data, safe recording, and the prohibition on live provider calls in tests.
- `apps/api/test/fixtures/serpapi/error-no-results.json`: Provider error fixture representing a place search with no results.
- `apps/api/test/fixtures/serpapi/error-quota.json`: Provider error fixture representing exhausted search quota.
- `apps/api/test/fixtures/serpapi/reviews-empty.json`: Successful-looking place response containing no reviews.
- `apps/api/test/fixtures/serpapi/reviews-malformed.json`: Mixed incomplete/invalid review records used to test tolerant parsing of missing or unusable fields.
- `apps/api/test/fixtures/serpapi/reviews-page-1.json`: Synthetic first page of reviews with a next-page token for pagination tests.
- `apps/api/test/fixtures/serpapi/reviews-page-2.json`: Synthetic final review page without a next-page token.
- `apps/api/test/fixtures/serpapi/reviews-real.json`: Recorded live provider response with key-bearing URLs scrubbed, used to check parsing against realistic data.

## `apps/web/`: frontend configuration

- `apps/web/.env.example`: Browser configuration template for the API base URL and public Clerk publishable key; no server secrets belong here.
- `apps/web/index.html`: HTML entry document containing the React root element and application entry-module reference.
- `apps/web/package.json`: Frontend dependencies and commands for Vite development, preview, builds, typechecking, and tests.
- `apps/web/tsconfig.json`: Browser/React TypeScript configuration, including DOM types, JSX, Vite, and testing-library types.
- `apps/web/vite.config.ts`: Configures React, shared-source imports, the fixed development port, and jsdom component tests.

## `apps/web/src/`: frontend entry and global UI

- `apps/web/src/main.tsx`: Validates browser configuration and mounts React with routing, Clerk, the app, or a configuration-error screen.
- `apps/web/src/styles.css`: Global design tokens and responsive styling for layout, navigation, buttons, forms, target workspaces, status messages, and loaders.
- `apps/web/src/test-setup.ts`: Adds DOM test matchers and cleans up rendered components after each test.

## `apps/web/src/app/`: routing and layout

- `apps/web/src/app/App.tsx`: Defines public/protected routes and wraps pages in the API client provider and shared application shell.
- `apps/web/src/app/App.test.tsx`: Tests protected navigation, sign-in return paths, sign-out removal of protected content, sidebar behavior, and safe error pages.
- `apps/web/src/app/AppShell.tsx`: Shared header, account controls, signed-in target sidebar, and main outlet for the current page.
- `apps/web/src/app/ConfigErrorScreen.tsx`: Displays startup configuration problems and explains how to complete the web environment file.
- `apps/web/src/app/ConfigErrorScreen.test.tsx`: Tests that the configuration screen lists each problem clearly.
- `apps/web/src/app/NotFoundPage.tsx`: Displays a missing-page message and a link back to the home page.
- `apps/web/src/app/routing/ClerkProviderWithRouter.tsx`: Connects Clerk navigation to React Router and configures the post-sign-out destination.
- `apps/web/src/app/routing/RequireSignedIn.tsx`: Waits for session loading, blocks signed-out protected pages, and preserves the intended internal destination for sign-in.

## `apps/web/src/components/ui/` and `config/`: reusable UI and settings

- `apps/web/src/components/ui/LoadingState.tsx`: Reusable accessible spinner with a visible loading label.
- `apps/web/src/config/env.ts`: Validates the public API URL and Clerk key and returns readable startup configuration problems.
- `apps/web/src/config/env.test.ts`: Tests valid browser configuration, missing settings, and rejection of Clerk secret keys.

## `apps/web/src/features/auth/` and `home/`: sign-in experience

- `apps/web/src/features/auth/api.ts`: Calls `/api/session` to check that the backend accepts the current session.
- `apps/web/src/features/auth/components/AccountControls.tsx`: Shows a Clerk sign-in button or signed-in account menu in the header.
- `apps/web/src/features/auth/components/SessionStatus.tsx`: Reusable component showing whether an API session check is pending, verified, or failed; not mounted by current page routes.
- `apps/web/src/features/home/pages/HomePage.tsx`: Public welcome/sign-in page that redirects signed-in users to a safe requested destination or their target list.

## `apps/web/src/features/targets/`: create and browse targets

- `apps/web/src/features/targets/api.ts`: Defines target response types and API calls for creating, listing, and opening targets, plus the target-list refresh event name.
- `apps/web/src/features/targets/components/RecentTargets.tsx`: Loads recent targets into sidebar links and refreshes when a target is created, with loading, empty, and error states.
- `apps/web/src/features/targets/components/RecentTargets.test.tsx`: Tests workspace links, empty state, and refresh after successful target creation.
- `apps/web/src/features/targets/pages/CreateTargetPage.tsx`: Target-creation form with shared validation, submission/loading feedback, field errors, success links, and sidebar refresh notification.
- `apps/web/src/features/targets/pages/CreateTargetPage.test.tsx`: Tests validation, successful creation, backend field errors, and duplicate-submission prevention.

## `apps/web/src/features/ingestion/` and `workspace/`: target workspace

- `apps/web/src/features/ingestion/api.ts`: API calls to fetch a target's latest ingestion run and start a new one.
- `apps/web/src/features/workspace/pages/WorkspaceHomePage.tsx`: Lists the signed-in user's targets with workspace links, platform/source details, and loading, empty, or error feedback.
- `apps/web/src/features/workspace/pages/WorkspaceHomePage.test.tsx`: Tests target-list content, empty state, and safe load-failure messages.
- `apps/web/src/features/workspace/pages/TargetWorkspacePage.tsx`: Displays an owned target and latest ingestion status/count, starts ingestion, and keeps loading/errors tied to the active target.
- `apps/web/src/features/workspace/pages/TargetWorkspacePage.test.tsx`: Tests workspace details, ingestion initiation, access denial, failed status loading, and safe start-ingestion errors.

## `apps/web/src/lib/`: frontend networking and safety helpers

- `apps/web/src/lib/api-client.ts`: Shared GET/POST client attaching Clerk tokens, unwrapping API data, and converting network/server failures into safe `ApiError` objects.
- `apps/web/src/lib/api-client.test.ts`: Tests token headers, JSON POSTs, response unwrapping, field-error preservation, and safe network/error handling.
- `apps/web/src/lib/api-context.tsx`: Provides the authenticated API client through React context and exposes the `useApi` hook.
- `apps/web/src/lib/use-api-client.ts`: Memoizes an API client whose token supplier reads the current Clerk session.
- `apps/web/src/lib/errors.ts`: Maps recognized backend error codes to safe frontend messages, with generic and network-error fallbacks.
- `apps/web/src/lib/errors.test.ts`: Tests code-to-message mapping and refusal to show raw or unrecognized server error messages.
- `apps/web/src/lib/return-to.ts`: Validates internal return destinations and builds sign-in URLs while blocking external/open-redirect patterns.
- `apps/web/src/lib/return-to.test.ts`: Tests safe internal destinations, rejection of malicious return paths, and destination encoding.

## `packages/shared/`: contracts used by both apps

- `packages/shared/package.json`: Shared-package dependencies, exports, build/typecheck/test scripts, and source-versus-compiled entry points.
- `packages/shared/tsconfig.json`: Type-checks shared source using the repository's strict TypeScript settings.
- `packages/shared/tsconfig.build.json`: Emits production JavaScript and declaration files into `dist`, excluding tests.
- `packages/shared/src/index.ts`: Public barrel exporting target, Clerk-key, error, and ingestion contracts.
- `packages/shared/src/analysis-targets.ts`: Shared Zod rules and input type for target names and HTTP(S) source URLs; rejects extra ownership/platform fields.
- `packages/shared/src/analysis-targets.test.ts`: Tests trimming, valid inputs, invalid names/URLs, and rejection of client-supplied ownership/platform values.
- `packages/shared/src/clerk.ts`: Checks Clerk publishable-key structure so both apps can reject malformed or secret keys at startup.
- `packages/shared/src/clerk.test.ts`: Tests accepted publishable keys and rejection of placeholders, invented keys, and secret keys.
- `packages/shared/src/errors.ts`: Defines request and ingestion error-code sets, plus the standard API error-envelope schema and types.
- `packages/shared/src/errors.test.ts`: Tests valid error envelopes and rejection of unknown codes or unrelated response shapes.
- `packages/shared/src/ingestion.ts`: Defines the strict empty start-ingestion request, lifecycle statuses, and ingestion-run response schema/types.

## `docs/`: project guidance and demo documentation

- `docs/engineering-standards.md`: Team rules for architecture, layering, naming, APIs, errors, logging, testing, dependencies, and Git workflow.
- `docs/security-guardrails.md`: Authentication, ownership, secrets, logging, and cross-user isolation requirements for all implementation and tests.
- `docs/ui-ux-standards.md`: Shared navigation, layout, form, validation, loading, button, spacing, and typography conventions.
- `docs/AI_assisted_development.md`: AI-assisted development/review expectations, dependency verification, required tests, and transcript-retention rules.
- `docs/ingestion-approach.md`: Explains the SerpApi design, supported Maps URLs, pagination, field mapping, outcomes, and safe fixture recording.
- `docs/demo-setup.md`: Setup/rehearsal checklist, previously recorded live/automated verification, recovery guidance, and remaining demo dependencies.

## `ai-transcripts/`: development records

These records document earlier development activity; the current source files are authoritative for implemented behavior.

- `ai-transcripts/2026-11-07_nicholas_Github Copilot_S1-014_AnalysisTarget Persistance.md`: AI-assisted development conversation for the initial target persistence/schema work and tests.
- `ai-transcripts/2026-11-08_nicholas_Github Copilot_S1-015+S1-017_Create and list AnalysisTargets.md`: Development conversation covering target creation/listing, user mapping, validation, tests, and related ownership decisions.
- `ai-transcripts/2026-11-09_sah_codex_S1-012_target-authorization.md`: Edited AI work summary for owner-only target read/delete endpoints, isolation tests, and local verification.
- `ai-transcripts/2026-11-09_sah_codex_S1-018_target-workspace.md`: Edited AI work summary for the protected target workspace, ingestion controls/latest status, and verification scope.

## How the main pieces connect

1. **Start:** `server.ts` creates the API dependencies; `main.tsx` starts the browser app.
2. **Authenticate:** Clerk verifies the session; `require-user.ts` resolves the internal user through `users.repository.ts`.
3. **Create/open a target:** The frontend target API calls the target routes, service, and owner-scoped repository.
4. **Collect reviews:** The workspace calls the ingestion route; the service verifies ownership and uses the SerpApi adapter.
5. **Normalize and record the outcome:** `review-normalizer.ts` filters/cleans raw reviews; the service saves the run status/count through `ingestion-runs.repository.ts`.

## Verification notes

- Matched inventory entries against `git ls-files` for the pinned commit: every tracked file appears once in the directory inventory.
- Inspected source, schema, migrations, configuration, test cases, and documentation to describe actual responsibilities rather than filenames alone.
- The guide received a separate source-based accuracy review. Its inventory and Markdown formatting were checked independently of the repository's normal formatting exclusions.
- Local checks passed: lint, repository formatting, typecheck, production build, and 190 tests. Another 31 database tests were skipped because this environment has no configured PostgreSQL test database.
- This is a documentation-only change. No services, database migrations, or provider calls were run, and no existing project files were changed. Database-backed checks still need a PostgreSQL-equipped environment or CI.

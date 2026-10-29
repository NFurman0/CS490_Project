# ReviewLens Engineering & Coding Standards

This document defines how code is written and organized in ReviewLens. 

| Document | Story | Owns |
|---|---|---|
| `docs/engineering-standards.md` | S1-001 | Code organization, naming, tooling, API and error conventions, logging, dependencies, testing, Git workflow |
| `docs/ui-ux-standards.md` | S1-002 | Navigation, layout, forms, how errors and loading states are presented |
| `docs/security-guardrails.md` | S1-003 | Identity mapping, ownership enforcement, secrets, sensitive data, cross-user isolation testing |
| `docs/ai-assisted-development.md` | S1-004 | Prompting, reviewing, and validating AI-generated code; transcript retention |

AI coding tools: read this file and `docs/security-guardrails.md` before generating code, and do not introduce patterns, libraries, or folder structures that this document does not describe.

---

## 1. Stack and Tooling

| Concern | Choice |
|---|---|
| Language | TypeScript everywhere, `strict: true` |
| Frontend | React + Vite |
| Backend | Node.js + Express |
| Database | PostgreSQL |
| ORM / migrations | Prisma |
| Authentication | Clerk (`@clerk/react` on web, `@clerk/express` on API) |
| Validation | Zod (schemas shared between web and API) |
| Review ingestion | SerpApi Google Maps Reviews, behind an adapter |
| Logging | pino (structured JSON) |
| Testing | Vitest, Supertest (API), React Testing Library (web) |
| Lint / format | ESLint (flat config + typescript-eslint), Prettier |
| Package manager | npm workspaces |
| CI | GitHub Actions |

Choices still awaiting team confirmation are listed in [Section 13](#13-open-decisions).

---

## 2. Repository Organization

```
/
├── apps/
│   ├── web/                    React frontend
│   │   └── src/
│   │       ├── app/            Routing, providers, layout shell
│   │       ├── features/       One folder per feature (targets/, ingestion/, ...)
│   │       │   └── targets/
│   │       │       ├── components/
│   │       │       ├── hooks/
│   │       │       └── api.ts  Feature's calls to the backend
│   │       ├── components/ui/  Shared, feature-agnostic components
│   │       └── lib/            API client, error-code mapping, utilities
│   └── api/                    Node backend
│       ├── prisma/             schema.prisma and migrations
│       ├── src/
│       │   ├── app.ts          Builds the Express app (no listen); used by tests
│       │   ├── server.ts       Starts the server
│       │   ├── config/env.ts   Validated environment configuration
│       │   ├── middleware/     auth, request ID, error handler
│       │   ├── modules/        One folder per domain module
│       │   │   ├── targets/
│       │   │   │   ├── targets.routes.ts
│       │   │   │   ├── targets.service.ts
│       │   │   │   ├── targets.repository.ts
│       │   │   │   └── targets.service.test.ts
│       │   │   ├── ingestion/
│       │   │   └── reviews/
│       │   ├── adapters/       External services (serpapi/, ...)
│       │   └── lib/            errors.ts, logger.ts, shared helpers
│       └── test/
│           ├── integration/    HTTP + database tests
│           ├── fixtures/       Recorded provider responses, sample data
│           └── helpers/        Test app factory and test utilities
├── packages/
│   └── shared/                 Zod schemas, shared types, error codes
├── docs/                       Context documents and architecture
├── ai-transcripts/             AI-assisted development transcripts
└── .github/workflows/          CI configuration
```

- Organize by **domain module**, not by technical layer across the whole app. Everything about targets lives in `modules/targets/`.
- `apps/web` and `apps/api` never import from each other. Shared contracts go in `packages/shared`.

---

## 3. Backend Layering

Each API module follows **routes → service → repository**, with external services behind adapters.

| Layer | Responsibility | May not |
|---|---|---|
| **Routes** | Validate input with Zod, read the authenticated user from `req`, call a service, shape the response | Touch Prisma or external SDKs |
| **Service** | Business rules, ownership checks, orchestration | Read `req`/`res` or format HTTP responses |
| **Repository** | All database access via Prisma | Contain business rules |
| **Adapter** | All external service access (SerpApi, later the LLM) behind an app-defined interface | Leak provider-specific types beyond the adapter |

Repository functions for user-owned data take `ownerId` as a required parameter and include it in every query. The full ownership pattern, including how child resources are authorized, is defined in `docs/security-guardrails.md` and is mandatory.

---

## 4. Naming Conventions

| Thing | Convention | Example |
|---|---|---|
| Variables, functions | camelCase | `sourceUrl`, `createTarget()` |
| Types, interfaces, classes, React components | PascalCase | `AnalysisTarget`, `TargetList` |
| Constants and env variables | UPPER_SNAKE_CASE | `MAX_REVIEWS_PER_RUN`, `DATABASE_URL` |
| React component files | PascalCase `.tsx` | `TargetList.tsx` |
| Other TS files | kebab-case with role suffix | `targets.service.ts`, `serpapi.parser.ts` |
| Test files | Same name + `.test.ts(x)`, next to the source | `targets.service.test.ts` |
| Prisma models | PascalCase singular | `AnalysisTarget`, `IngestionRun` |
| Database tables / columns | snake_case via `@@map` / `@map` | `analysis_targets`, `owner_id` |
| API paths | Plural kebab-case nouns | `/api/analysis-targets/:targetId/ingestion-runs` |
| JSON fields | camelCase | `{ "sourceUrl": "..." }` |
| Error codes | UPPER_SNAKE_CASE | `VALIDATION_FAILED` |

Use the domain vocabulary from the spec consistently: **AnalysisTarget**, **IngestionRun**, **Review**. Do not invent synonyms like "project", "job", or "place" for these.

---

## 5. Formatting, Linting, and Type Checking

- Prettier is the single source of formatting truth.
- ESLint runs `typescript-eslint` recommended rules plus:
  - `@typescript-eslint/no-explicit-any`: **error**. Use `unknown` and narrow.
  - `no-console`: **error** in `apps/api` (use the logger).
- No `@ts-ignore`. Use `@ts-expect-error` only with a comment explaining why.
- Disabling a lint rule requires an inline comment with a justification.

Root scripts, identical to what CI runs:

```bash
npm run lint          # ESLint across all workspaces
npm run format:check  # Prettier check
npm run typecheck     # tsc --noEmit across all workspaces
npm test              # Vitest across all workspaces
npm run build         # Production builds
```

Run all five before opening a PR.

---

## 6. API Conventions

### 6.1 Routes

- All endpoints live under `/api`. Every route except `GET /api/health` requires authentication.
- Request bodies are validated with a Zod schema from `packages/shared` before reaching the service.
- IDs are UUIDs. Timestamps are ISO 8601 strings in UTC.

### 6.2 Response envelope

Success:

```json
{ "data": { "id": "…", "name": "Joe's Pizza", "platform": "google_maps" } }
```

Lists return `{ "data": [ … ] }`.

Error:

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Please check the highlighted fields.",
    "details": { "fieldErrors": { "sourceUrl": ["Enter a Google Maps place link."] } },
    "requestId": "…"
  }
}
```

`message` must always be safe to show an end user. `details` holds only structured, user-safe information such as field errors.

### 6.3 Request-level error codes

| Code | HTTP | When |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Input fails schema or business validation |
| `UNAUTHENTICATED` | 401 | Missing, invalid, or expired session token |
| `NOT_FOUND` | 404 | Resource does not exist or is not owned by the caller (see `docs/security-guardrails.md`) |
| `CONFLICT` | 409 | E.g., an ingestion run is already in progress for this target |
| `INTERNAL_ERROR` | 500 | Anything unexpected |

### 6.4 Ingestion outcome codes

An ingestion request that passes the request checks (authenticated, target owned, source present) creates an `IngestionRun`. Provider and source failures are **outcomes of that run**, stored as `status: "failed"` with an `errorCode`, not HTTP errors (S1-BR-023).

| `errorCode` | Meaning |
|---|---|
| `SOURCE_UNRESOLVABLE` | The URL could not be resolved to a Google Maps place |
| `SOURCE_NO_REVIEWS` | The place resolved but returned no usable reviews |
| `PROVIDER_TIMEOUT` | SerpApi did not respond in time |
| `PROVIDER_QUOTA_EXHAUSTED` | SerpApi search quota is used up |
| `PROVIDER_ERROR` | SerpApi returned an error or an unexpected response shape |

These outcomes must stay distinct (S1-020). A failed run never creates Review records (S1-BR-024).

---

## 7. Error Handling

- Throw `AppError` (from `apps/api/src/lib/errors.ts`) for expected failures. It carries `code`, `httpStatus`, and a user-safe `message`.
- One central error-handling middleware produces the envelope above:
  - `AppError` → its code, status, and message.
  - `ZodError` → `400 VALIDATION_FAILED` with field errors.
  - Anything else → `500 INTERNAL_ERROR` with a generic message. The original error is logged, never sent.
- Never return `err.message` or `err.stack` from an unknown error, or Prisma, Clerk, or SerpApi error text, to the client.
- Adapters translate provider-specific errors into `AppError`s or outcome codes at the adapter boundary.
- Every `catch` handles, rethrows, or converts the error. Empty `catch` blocks are not allowed.
- On the frontend, error `code` values are mapped to user messages in one place, `apps/web/src/lib/errors.ts`. How those messages are displayed is defined in `docs/ui-ux-standards.md`.

---

## 8. Logging

- Use the shared pino logger (`apps/api/src/lib/logger.ts`). No `console.log` in API code.
- Every request gets a request ID from middleware. Include it in logs and in error responses so a reported failure can be traced.
- Log structured fields, not interpolated strings:
  ```ts
  logger.info({ targetId, runId, reviewsIngested }, 'ingestion run completed');
  ```
- Levels: `error` for failures needing attention, `warn` for handled problems (e.g., provider timeout), `info` for lifecycle events (ingestion started/finished), `debug` for development detail. `LOG_LEVEL` sets the level.
- What must never be logged, and the logger's redaction rules, are defined in `docs/security-guardrails.md`.

---

## 9. Configuration

- All configuration is read once, in `apps/api/src/config/env.ts`, and validated with Zod at startup. A missing or invalid required variable stops the server with a message naming the variable.
- Code reads configuration from the exported `env` object, never `process.env` directly.
- Tunable limits are configuration, not magic numbers, e.g. `MAX_REVIEWS_PER_RUN`.
- Which values are secrets and where they may live is defined in `docs/security-guardrails.md`.

---

## 10. Adding Dependencies

1. Check whether an existing dependency or a few lines of code already do the job.
2. Confirm the package is actively maintained (recent releases, reasonable adoption, open-source license).
3. Install it in the workspace that needs it (`npm install <pkg> -w apps/api`), not the root, unless it's shared dev tooling.
4. Mention the new dependency and why it's needed in the PR description.

The lockfile (`package-lock.json`) is always committed, and CI installs with `npm ci`. Additional checks for dependencies suggested by AI tools are in `docs/ai-assisted-development.md`.

---

## 11. Testing Expectations

Every story adds or updates at least one automated test. A story is not done until its tests pass locally and in CI.

### 11.1 Test types and locations

| Type | Location | Tools | Examples |
|---|---|---|---|
| Unit | Next to the source file | Vitest | Normalizer, URL validator, SerpApi parser, services with fakes |
| Integration | `apps/api/test/integration/` | Vitest + Supertest + test Postgres | Endpoint behavior, persistence round-trips |
| Component | Next to the component | Vitest + React Testing Library | Form validation messages, ingestion status display |

### 11.2 Required coverage of behavior

| Story type | Must test |
|---|---|
| Any user-facing behavior | Happy path + at least one non-happy path |
| Validation | Valid input accepted; each invalid case rejected with `VALIDATION_FAILED` and nothing persisted |
| Persistence | Created data can be read back with the correct values |
| Ingestion | Valid fixture normalized correctly; malformed records handled per rules; provider failures produce the right `errorCode` and zero reviews |
| Authentication / authorization | As defined in `docs/security-guardrails.md` |

### 11.3 Rules

- Tests never call live external services. SerpApi responses come from recorded fixtures in `apps/api/test/fixtures/serpapi/`.
- Integration tests use a dedicated test database (`DATABASE_URL` in `.env.test`, and a Postgres service container in CI). Tables are reset between tests.
- Name tests after behavior, so a failing test explains itself:
  ```ts
  it('rejects a target whose source URL is not a Google Maps link', …)
  ```
- Assert observable behavior (status codes, response bodies, database state), not internal calls, wherever practical.

---

## 12. Git Workflow and Pull Requests

- `main` is protected: no direct pushes, required CI checks, and at least one approving review.
- Branch per story: `Developer_Name/S1-0XX`.
- Commit messages follow Conventional Commits with the story ID:
  `feat(targets): validate Google Maps source URL [S1-016]`
- PR title starts with the story ID. Squash-merge into `main`.
- Every PR description includes:
  ```markdown
  ## Story
  S1-0XX — <Title>

  ## Summary
  What changed and why.

  ## Test Evidence
  Tests added/updated and what each verifies.

  ## Security / Ownership Impact
  Does this touch auth, ownership, secrets, or user data? How is it protected?
  ```

---

## 13. Open Decisions

Decisions to be agreed upon.

| Decision | Draft choice | Alternatives |
|---|---|---|
| Backend framework | Express | Fastify, Hono |
| ORM | Prisma | Drizzle |
| Package manager | npm workspaces | pnpm |
| Cross-user response | `404 NOT_FOUND` | `403 FORBIDDEN` |
| Ingestion execution | Synchronous with a review cap | Background job + polling |
| API hosting (Sprint 3) | Not decided | Vercel functions, Render, Railway, Fly.io |

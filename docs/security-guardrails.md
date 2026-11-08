# ReviewLens Data & Security Guardrails

This document defines how ReviewLens authenticates users, who owns what data, where ownership is enforced, how secrets are handled, and how isolation between users is tested. It applies to all code: human-written, AI-generated, and tests.

> **The core rule:** every query and mutation that touches user-owned data is scoped to the authenticated user, and that user's identity comes only from a verified Clerk session token. If you can't point to where a query is scoped to the caller, the query is not allowed.

AI coding tools: treat every rule in this document as mandatory. If a requested change would require breaking one of them, stop and say so instead of working around it.

| S1-003 requirement | Section |
|---|---|
| Which managed identity provider the team selected | [1](#1-managed-identity-provider) |
| How provider identity maps to application ownership | [2](#2-mapping-identity-to-ownership) |
| Which entities are user-scoped | [3](#3-user-scoped-entities) |
| Where authorization is enforced | [4](#4-where-authorization-is-enforced) |
| Why client-supplied ownership identifiers are not trusted | [5](#5-client-supplied-identifiers-are-never-trusted) |
| How secrets and environment configuration are managed | [6](#6-secrets-and-environment-configuration) |
| How developers will test cross-user isolation | [9](#9-testing-cross-user-isolation) |

---

## 1. Managed Identity Provider

ReviewLens uses **Clerk** (S1-BR-001). We do not store passwords, hash credentials, or build login, registration, or password-reset flows (S1-BR-002).

| Clerk handles | ReviewLens handles |
|---|---|
| Registration, login, logout, password reset | Verifying the session token on **every** protected API request (S1-BR-004) |
| Credential storage and session management | Mapping the Clerk user to our own `User` record (S1-BR-005) |
| Issuing signed, short-lived session tokens | Ensuring each user can reach only their own data (S1-BR-007 to S1-BR-010) |

Installing Clerk and hiding UI controls satisfies none of the right-hand column.

### 1.1 Request flow

1. The web app (`@clerk/react`) gets a session token with `getToken()` from `useAuth()` and sends it on every API call as `Authorization: Bearer <token>`. The shared API client in `apps/web/src/lib/` does this; feature code never builds auth headers itself.
2. The API runs `clerkMiddleware()` from `@clerk/express`, configured with `authorizedParties: [env.WEB_ORIGIN]` so tokens issued for other origins are rejected.
3. Our `requireUser` middleware calls `getAuth(req)`. If `isAuthenticated` is false, it responds `401 UNAUTHENTICATED` with no data. Otherwise it resolves the internal user (Section 2) and sets `req.user`.

Do **not** use Clerk's `requireAuth()` on API routes. It redirects unauthenticated requests instead of returning `401`, which is wrong for a JSON API.

### 1.2 Logout

Logout calls Clerk's `signOut()`, which ends the session; the web app can no longer obtain tokens and returns to the signed-out view (S1-BR-006). Clerk session tokens are short-lived (60 seconds by default), and the API verifies them without calling Clerk on each request. A token captured before logout therefore remains valid until it expires, at most about a minute. This is an accepted limitation of Clerk's session model and is documented here so no one claims otherwise.

---

## 2. Mapping Identity to Ownership

Clerk identifies users with a stable ID such as `user_2abc…`. ReviewLens maps it to an internal `User` record:

```prisma
model User {
  id          String   @id @default(uuid())
  clerkUserId String   @unique @map("clerk_user_id")
  createdAt   DateTime @default(now()) @map("created_at")
  targets     AnalysisTarget[]
  @@map("users")
}
```

- `requireUser` looks up the `User` by `clerkUserId` and creates it on the user's first authenticated request (an upsert, protected by the unique constraint). No webhook is needed in Sprint 1.
- `req.user = { id, clerkUserId }`. **`req.user.id` is the only value ever used as `ownerId`.**
- Ownership columns reference the internal `User.id`, not the Clerk ID. This keeps provider-specific identifiers out of our domain model (Technical Spec 2.3) and means only one place in the codebase knows about Clerk IDs.

---

## 3. User-Scoped Entities

Every entity except the health check is user-scoped (S1-BR-007).

| Entity | How it's owned | Access rule |
|---|---|---|
| `User` | Is the owner | A user can only resolve to their own record, via their token |
| `AnalysisTarget` | Directly: `owner_id` → `users.id`, `NOT NULL` | Accessible only when `ownerId` matches `req.user.id` |
| `IngestionRun` | Transitively, through `target_id` → `analysis_targets` | Accessible only through an owned target |
| `Review` | Transitively, through `target_id` (and `ingestion_run_id`) | Accessible only through an owned target |
| `ChatSession` / `ChatMessage` (Sprint 2, if built) | Transitively, through the target | Same as above |

Rules for transitive ownership:

- Child records (`IngestionRun`, `Review`) are **never** looked up or modified by their own ID alone. The parent target's ownership is checked first, every time (Section 4.3).
- Foreign keys are `NOT NULL` with `onDelete: Cascade` from target to children, so deleting a target cannot leave orphaned reviews that no ownership check can reach.
- **Review content is protected user data**, not just metadata. In Sprint 2, the Q&A context sent to the LLM must be built only from reviews of the active, owned target, and that boundary is enforced before the model is called (Technical Spec 3.3).

---

## 4. Where Authorization Is Enforced

Authorization is enforced on the **backend**, in layers. The frontend layer is a convenience, not a control (S1-BR-009).

| Layer | What it enforces | Is it a security control? |
|---|---|---|
| Frontend route guards | Signed-out users are redirected away from app pages | **No** — UX only |
| `requireUser` middleware | Every `/api` route except `GET /api/health` requires a valid token | Yes — authentication |
| Service layer | The caller owns the target being accessed | Yes — the authoritative ownership check |
| Repository layer | Every user-scoped query includes `ownerId` | Yes — defense in depth |
| Database | `NOT NULL` owner and parent foreign keys | Yes — integrity |

### 4.1 Secure by default

`requireUser` is mounted once on the `/api` router, before any feature routes. A new route is protected automatically; making a route public requires an explicit, reviewed exception. Only `GET /api/health` is public, and it returns no user data.

### 4.2 The ownership pattern (mandatory)

Repository functions for user-owned data take `ownerId` as a required parameter and include it in the query:

```ts
// Correct
findTargetById(ownerId: string, targetId: string) {
  return prisma.analysisTarget.findFirst({ where: { id: targetId, ownerId } });
}

// FORBIDDEN — finds the record for anyone who knows the ID
prisma.analysisTarget.findUnique({ where: { id: targetId } });
```

Mutations follow the same rule, so a non-owner's update or delete affects nothing:

```ts
const result = await prisma.analysisTarget.updateMany({
  where: { id: targetId, ownerId },
  data: { name },
});
if (result.count === 0) throw new AppError('NOT_FOUND', 404, 'Analysis target not found.');
```

### 4.3 Child resources

Services reach child resources through `getOwnedTargetOrThrow`, which every module uses:

```ts
async function getOwnedTargetOrThrow(ownerId: string, targetId: string) {
  const target = await targetsRepository.findTargetById(ownerId, targetId);
  if (!target) throw new AppError('NOT_FOUND', 404, 'Analysis target not found.');
  return target;
}

// Ingestion service
async function startIngestion(ownerId: string, targetId: string) {
  const target = await getOwnedTargetOrThrow(ownerId, targetId); // 1. ownership first
  // 2. then check source information is present
  // 3. only then create the IngestionRun and call the SerpApi adapter
}
```

The order matters: a request against another user's target fails **before** any IngestionRun is created or the SerpApi adapter is called (S1-019).

### 4.4 Cross-user access returns 404

A target that exists but belongs to another user is treated exactly like a target that doesn't exist: `404 NOT_FOUND`, the same message, and no data from the resource in the body. Returning `403` would confirm to an attacker that the ID is valid. For the demo, this `404` is the "access denied" evidence: User B requests a real User A target and receives nothing.

---

## 5. Client-Supplied Identifiers Are Never Trusted

Everything in a request body, query string, route parameter, or custom header is controlled by whoever sends the request. Anyone can open dev tools or curl and change it. The **only** trusted identity is the one in a Clerk token whose signature our backend has verified (S1-BR-010).

Rules:

- No request schema contains `ownerId`, `userId`, or `clerkUserId`. Request schemas are `.strict()`, so a body that includes them is rejected with `400 VALIDATION_FAILED`.
- Never spread a request body into a Prisma call (`data: { ...req.body }`). Build the `data` object field by field and set `ownerId: req.user.id` explicitly.
- Route parameters like `:targetId` say **which** resource to look up. They are never evidence that the caller may access it; the ownership check decides that.
- Never return or rely on Clerk user IDs in API responses. Clients don't need them.

---

## 6. Secrets and Environment Configuration

### 6.1 Configuration inventory

| Variable | Used by | Secret? |
|---|---|---|
| `DATABASE_URL` | API | **Secret** |
| `CLERK_SECRET_KEY` | API | **Secret** |
| `SERPAPI_API_KEY` | API | **Secret** |
| `CLERK_PUBLISHABLE_KEY` | API | Public (by Clerk's design) |
| `WEB_ORIGIN` | API (CORS, `authorizedParties`) | Not secret |
| `LOG_LEVEL`, `MAX_REVIEWS_PER_RUN` | API | Not secret |
| `VITE_CLERK_PUBLISHABLE_KEY` | Web | Public (by Clerk's design) |
| `VITE_API_BASE_URL` | Web | Not secret |

An LLM provider key will be added in Sprint 2 as an API-only secret.

### 6.2 Rules

- Real `.env` files are git-ignored. `.env.example` lists every variable with a placeholder value and is the single source of truth for what's required.
- The API validates configuration at startup and refuses to start if a required variable is missing (Engineering Standards §9).
- **Only values designed to be public may use the `VITE_` prefix.** Vite embeds every `VITE_` variable in the browser bundle, where anyone can read it. A secret with a `VITE_` prefix is a leaked secret (S1-BR-011).
- The browser never calls SerpApi, the database, or Clerk's backend API. The frontend calls our API; only our API calls providers.
- CORS allows only `WEB_ORIGIN`.
- Secrets are shared within the team through a password manager or the provider dashboards, **never** in chat, issues, PRs, commit messages, test fixtures, or AI transcripts.
- CI does not need real provider keys: tests replace Clerk and SerpApi (Section 9). Any secret CI does need goes in GitHub Actions secrets.
- GitHub secret scanning and push protection are enabled on the repository.

### 6.3 If a secret leaks

**Rotate it immediately** in the provider dashboard, then update everyone's `.env`. Deleting the commit is not enough; anything pushed to GitHub, even briefly, must be treated as public. Tell the team in the same day.

---

## 7. Sensitive Data in Logs and Errors

Never log:

- `Authorization` headers, cookies, or session tokens.
- API keys or any value from Section 6.1 marked secret.
- Full SerpApi request URLs. **SerpApi passes `api_key` as a query parameter, so the URL contains the secret.** Log the target ID and run ID instead.
- Review text in bulk. Log counts and IDs.

The pino logger enforces the first items with redaction, and new sensitive paths are added to it as they appear:

```ts
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: ['req.headers.authorization', 'req.headers.cookie', '*.apiKey', '*.api_key', '*.secretKey'],
});
```

Error responses never include internal error text from Prisma, Clerk, or SerpApi (Engineering Standards §7).

---

## 8. Prohibited Patterns

| Prohibited | Why | Do instead |
|---|---|---|
| Querying a user-scoped model by ID alone (`findUnique({ where: { id } })`) | Anyone who knows or guesses the ID gets the record | Include `ownerId` in the `where` clause (§4.2) |
| Reading `ownerId`/`userId` from the body, query, params, or headers | Client-controlled; trivially forged | Use `req.user.id` (§5) |
| Fetching all records and filtering in code or in the browser | Other users' data leaves the database, and one bug exposes it | Filter by `ownerId` in the query |
| Accessing reviews or ingestion runs by their own ID | Skips the parent's ownership check | `getOwnedTargetOrThrow` first (§4.3) |
| Spreading `req.body` into Prisma `create`/`update` | Lets clients set fields like `ownerId` | Build `data` explicitly |
| `$queryRawUnsafe` or SQL built with string interpolation | SQL injection | Prisma queries, or the `$queryRaw` tagged template |
| Different responses for "doesn't exist" and "not yours" | Confirms valid IDs to attackers | `404 NOT_FOUND` for both (§4.4) |
| Clerk `requireAuth()` on API routes | Redirects instead of returning `401` | `requireUser` (§1.1) |
| Registering routes outside the protected `/api` router | Silently unauthenticated | Mount under the router that runs `requireUser` |
| Secrets in `VITE_` variables, frontend code, logs, fixtures, or transcripts | Exposed to anyone | Server-side env only (§6) |
| Any test identity mechanism reachable in production | A backdoor to impersonate users | Identity injection in test code only (§9.1) |

---

## 9. Testing Cross-User Isolation

### 9.1 How test identities work

`createApp()` takes its identity provider as a dependency instead of importing Clerk directly:

```ts
interface IdentityProvider {
  resolve(req: Request): Promise<{ clerkUserId: string } | null>;
}
```

- `server.ts` always passes the Clerk-backed provider.
- Tests build apps with a fake provider that returns a fixed identity. The fake lives only in `apps/api/test/helpers/`, outside `src/`, so it cannot be part of a production build.
- There is **no header, query parameter, or environment flag** that lets a running server accept a test identity.

```ts
const asUserA   = request(createTestApp({ as: 'user_a' }));
const asUserB   = request(createTestApp({ as: 'user_b' }));
const anonymous = request(createTestApp({ as: null }));
```

### 9.2 Required test matrix

Every endpoint that touches user-owned data has, at minimum:

| Caller | Expected result |
|---|---|
| Anonymous | `401 UNAUTHENTICATED`, response contains no resource data |
| Owner | Success with the correct data |
| Different authenticated user | `404 NOT_FOUND`, response contains no resource data, database state unchanged |

### 9.3 What the assertions must prove

A test that only checks the status code is not enough. Cross-user tests also assert:

- **No leaked data:** the response body contains nothing from User A's resource, e.g. `expect(JSON.stringify(res.body)).not.toContain(targetA.name)`.
- **No side effects:** User A's records are unchanged in the database afterward.
- **Rejected before processing:** for ingestion attempts against another user's target, no `IngestionRun` row is created and the fake SerpApi adapter was called zero times.

### 9.4 Manual verification against real Clerk

Automated tests use the fake identity provider, so the real Clerk path is verified manually and in the demo:

1. Sign in as User A and copy the ID of one of A's targets.
2. Sign in as User B in another browser profile. In the dev tools console, run `await window.Clerk.session.getToken()` to get B's token.
3. Run:
   ```bash
   curl -i -H "Authorization: Bearer <USER_B_TOKEN>" \
     http://localhost:3000/api/analysis-targets/<USER_A_TARGET_ID>
   ```
4. Expect `404` with no target data. Repeat without the header and expect `401`.

Never paste real tokens into issues, PRs, or AI transcripts. They are short-lived, but they are still credentials.

---

## 10. Review Checklist

Reviewers check every PR that touches user data, authentication, or configuration:

- [ ] Every new query on a user-scoped model includes `ownerId`, or goes through `getOwnedTargetOrThrow`.
- [ ] No ownership value is read from the request; `req.user.id` is the only source.
- [ ] New routes are mounted under the protected `/api` router.
- [ ] Cross-user and unauthenticated tests were added for new endpoints, following §9.2–§9.3.
- [ ] No secrets in code, `VITE_` variables, logs, fixtures, or the PR itself.
- [ ] New environment variables are added to `.env.example` and to startup validation.
- [ ] Error responses contain no provider or database error text.

# ReviewLens AI

A review intelligence portal that allows you to create an analysis target from a Google Maps place, ingest its reviews, and ask questions answered with those ingested reviews as context.

## Repository layout

| Path                 | Responsibility                                                   |
| -------------------- | ---------------------------------------------------------------- |
| `apps/web`           | Frontend: React + Vite + TypeScript                              |
| `apps/api`           | Backend: Node.js + Express + TypeScript                          |
| `packages/shared`    | Contracts shared by web and API: Zod schemas, types, error codes |
| `docker-compose.yml` | Local PostgreSQL database                                        |
| `docs/`              | Team context documents (start here)                              |
| `ai-transcripts/`    | AI-assisted development transcripts                              |
| `.github/`           | CI workflow and PR template                                      |

Before writing code, read:

- [`docs/engineering-standards.md`](docs/engineering-standards.md): Code conventions
- [`docs/security-guardrails.md`](docs/security-guardrails.md): Ownership, Auth, and Security rules
- [`docs/ui-ux-standards.md`](docs/ui-ux-standards.md): Interface conventions
- [`docs/ai-assisted-development.md`](docs/ai-assisted-development.md): Rules for AI-generated code

## Prerequisites

- **Node.js 24** (the version in `.nvmrc`; with nvm, run `nvm use`). Node 22.22 or later also works.
- **npm** (comes with Node)
- **Docker Desktop**, for the local database
- Access to the team's **Clerk** development instance and a **SerpApi** API key.

## First-time setup

```bash
# 1. Install dependencies for all workspaces
npm install

# 2. Create your local environment files from the templates
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
#    Then fill in the real values. Each variable is explained in its .env.example.

# 3. Start the local database
npm run db:up
```

`db:up` creates the AnalysisTarget tables on a new database and applies pending Prisma migrations. To run the database-backed persistence tests locally, copy `apps/api/.env.test.example` to `apps/api/.env.test`, then start the isolated test database with `npm run db:test:up`. Stop it with `npm run db:test:down`.

## Running locally

```bash
npm run dev
```

This starts both apps:

- Web: <http://localhost:5173>
- API: <http://localhost:3000> (check it with <http://localhost:3000/api/health>)

If configuration is missing or invalid, the API stops with a message naming each variable to fix, and the web app shows a configuration error screen instead of the app.

To stop the database: `npm run db:down`. Your data is kept in a Docker volume between runs.

## Signing in locally

ReviewLens uses [Clerk](https://clerk.com) for sign-in. The keys in your `.env` files must be real keys from the team's Clerk development application; made-up values are rejected at startup (Reach out to Aakash for keys).

1. In the Clerk Dashboard, open the team's development application and go to **Configure → API keys**.
2. Copy the **publishable key** (`pk_test_...`) into `VITE_CLERK_PUBLISHABLE_KEY` in `apps/web/.env` and `CLERK_PUBLISHABLE_KEY` in `apps/api/.env`.
3. Copy the **secret key** (`sk_test_...`) into `CLERK_SECRET_KEY` in `apps/api/.env` only. It must never go in the web app's `.env`.
4. Run `npm run dev`, open <http://localhost:5173>, and choose **Sign in**. After signing in, the page confirms that the API accepted your session.

Every page except the home page requires sign-in. Opening one while signed out, such as <http://localhost:5173/analysis-targets>, sends you to sign in and then back to that page.

To check the API directly, `curl -i http://localhost:3000/api/session` returns `401` without a session.

## Commands

All commands run from the repository root. CI runs the same commands on every pull request.

| Command                | What it does                                |
| ---------------------- | ------------------------------------------- |
| `npm run dev`          | Start the API and web app with live reload  |
| `npm run lint`         | ESLint across all workspaces                |
| `npm run format`       | Format all files with Prettier              |
| `npm run format:check` | Check formatting without changing files     |
| `npm run typecheck`    | TypeScript checks across all workspaces     |
| `npm test`             | Run all unit and integration tests          |
| `npm run build`        | Production builds of every workspace        |
| `npm run db:up`        | Start the local PostgreSQL container        |
| `npm run db:down`      | Stop it                                     |
| `npm run db:test:up`   | Start the isolated PostgreSQL test database |
| `npm run db:test:down` | Stop the isolated test database             |

Run `lint`, `format:check`, `typecheck`, `test`, and `build` before opening a PR.

## Environment configuration

Configuration lives in two files, one per app, so server secrets and browser values can never be mixed up:

- `apps/api/.env`: server-side values, including secrets. Never sent to the browser.
- `apps/web/.env`: `VITE_` values only. Vite embeds these in the browser bundle, so **only public values** belong here.

Real `.env` files are git-ignored. The `.env.example` files list every required variable. When you add a variable, add it to the matching `.env.example` and to its startup validation (`apps/api/src/config/env.ts` or `apps/web/src/config/env.ts`). See [`docs/security-guardrails.md`](docs/security-guardrails.md) §6 for the full secrets policy.

## Contributing

See [`docs/engineering-standards.md`](docs/engineering-standards.md) for branch naming, commit messages, and PR requirements. `main` is protected so changes go through a PR with passing CI checks and an approving review.

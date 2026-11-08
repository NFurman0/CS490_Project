# ReviewLens AI-Assisted Development & Review

This document defines how the team uses AI coding tools.

---

## 1. Potential AI Tools

| Tool                          | Typical use                                                                                               | Transcript source                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Claude (claude.ai)            | Planning, design discussion, documentation, explaining code                                               | Export or copy the full conversation                                                       |
| Claude Code                   | Multi-file changes in the repository                                                                      | The `/export` command or the session's saved conversation                                  |
| GitHub Copilot                | Inline completions, chat in the editor                                                                    | Chat sessions: the editor's chat export. Inline completions: none available                |
| Cursor                        | Editor chat and agent edits                                                                               | The chat export option                                                                     |
| OpenAI: ChatGPT and Codex     | ChatGPT for planning, discussion, and explaining code; Codex for multi-file changes in the repository     | ChatGPT: export or copy the full conversation. Codex: the session's saved conversation     |
| Google: Gemini and Gemini CLI | Gemini for planning, discussion, and explaining code; Gemini CLI for multi-file changes in the repository | Gemini: export or copy the full conversation. Gemini CLI: the session's saved conversation |

---

## 2. Supplying Context

Supply:

- `docs/engineering-standards.md` and `docs/security-guardrails.md`, plus `docs/ui-ux-standards.md` for frontend work.
- The story ID, its outcome, and its canonical rule IDs (e.g., `S1-016`, `S1-BR-015`) from the issue.
- The existing files the change touches, and one or two existing files that show the pattern to follow.
- Installed versions of relevant libraries from `package.json`, so the tool doesn't write code for an older or newer API.

Never Supply:

- Secrets: API keys, `.env` contents, database URLs with credentials, Clerk session tokens.
- Real users' data or another team member's account information.
- Production logs that may contain the above.

Sample Prompt Template:

```markdown
Implement story S1-0XX — <title>.
Outcome: <outcome from the issue>
Rules: <S1-BR IDs>
Follow docs/engineering-standards.md and docs/security-guardrails.md.
Relevant files: <paths>
Follow the pattern in: <path to an existing similar file>
Include tests per Engineering Standards §11, including the negative cases.
Do not add dependencies or change files outside this story without asking first.
```

---

## 3. Reviewing Generated Code

### 3.1 Author Expectations

- Read every line and be able to explain code
- Check that the change stays inside the story.
- Check conventions.
- Run lint, typecheck, tests, and build locally.

### 3.2 Reviewer Expectations

Reviewers apply the same standard to AI-generated code as to any other code.

---

## 4. Validating Dependencies and APIs

### 4.1 Packages

Before installing any package an AI tool suggests:

1. Find it on npmjs.com under the exact name.
2. Confirm it links to a real source repository, has recent releases, and has meaningful weekly downloads.

### 4.2 Library APIs

- `npm run typecheck` catches methods that don't exist, but not deprecated methods or behavior that changed.

---

## 5. Required Testing Before Acceptance

Generated code is accepted only when:

- It includes tests per Engineering Standards §11, including the required negative cases.
- Lint, typecheck, tests, and build pass locally and in CI.
- The author can explain what defect each new test prevents.

---

## 6. Transcript Retention

- Save the complete transcript.
- The only allowed edit is replacing a secret with `[REDACTED]`, and that secret must then be rotated.
- Save the transcript as Markdown where the tool supports it.
- Commit the transcript in the same PR as the work it produced.

Naming Convention:

```
YYYY-MM-DD_<member>_<tool>_<story-id>_<short-topic>.md
```

---

## 7. Additional Security Review

| Area                                                         | Typical generated mistake                                             |
| ------------------------------------------------------------ | --------------------------------------------------------------------- |
| Authentication middleware, `requireUser`, identity providers | Missing check, wrong Clerk API, test identity reachable in production |
| Repositories and services for user-scoped data               | Query by ID alone, ownership check after processing instead of before |
| Route registration                                           | Route mounted outside the protected `/api` router                     |
| Request schemas                                              | Accepting `ownerId`, or not using `.strict()`                         |
| Prisma schema and migrations                                 | Nullable owner columns, missing or wrong cascade rules                |
| Configuration, `.env.example`, `VITE_` variables             | Secret exposed to the browser                                         |
| Logging and the error handler                                | Logging tokens or SerpApi URLs; returning internal error text         |
| The SerpApi adapter                                          | Key placed where it can be logged; failures reported as success       |
| CI workflows (`.github/workflows/`)                          | Overly broad permissions, secrets exposed to untrusted code           |
| LLM prompt and context construction                          | Another target's or user's reviews entering the AI context            |

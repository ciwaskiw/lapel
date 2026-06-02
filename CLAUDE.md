# CLAUDE.md — orientation for lapel

**lapel** is a local, agentic CLI (+ a published MCP server) that finds jobs from public ATS APIs,
scores them for fit against a "living profile," and tailors résumé summaries + cover letters — never
fabricating experience. (Originally named "job-scout"; the historical spec/plans keep that name.)

## Run / build / test

- **Node 22 required** — the native `better-sqlite3` build breaks on Node 26. `node`/`npm` on this
  machine are already pinned to v22 (Homebrew `node@22` linked); no PATH prefix needed.
- `npm install` · `npm run build` (tsc → `dist/`, copies `schema.sql`) · `npm test` (vitest) ·
  `npm run lint` (eslint) · `npm run typecheck` · `npm run format` (prettier).
- Run the CLI in dev with `node dist/cli.js <cmd>` (after build) or `npm run dev -- <cmd>`.
- **Tests run with NO API key** — the LLM is mocked at the backend seam. Keep it that way.

## LLM backends (`LAPEL_BACKEND`)

- `subscription` (**default**) — shells out to the Claude Code `claude` CLI headless; uses the
  user's Claude Pro/Max subscription. No API key; requires `claude` installed + logged in.
- `api` — Anthropic Messages API; needs `ANTHROPIC_API_KEY`.

All LLM calls go through `structuredCall()` (`src/agent/llm.ts`) → an `LlmBackend.callOnce()`
(`src/agent/backend.ts`, backends in `src/agent/backends/`).

## Architecture invariants (don't break these)

- **Deterministic core, LLM on top.** `src/{sources,ingest,db,ui}`, `src/profile/{schema,store,pdf}.ts`,
  and `src/scoring/rubric.ts` must **not** import the Anthropic SDK or `src/agent/**`. This is
  **enforced by ESLint** (`no-restricted-imports`, scoped to those globs) — a violation fails lint.
- **One engine, two front-ends.** The CLI (`src/commands`, `src/cli.ts`) and the MCP server
  (`src/mcp`) are thin wrappers over the same core; no duplicated business logic.
- **Human-in-the-loop gate.** `find`/`add` only discover+score+persist (`status=new`); `tailor` is
  always an explicit per-job action. They never auto-chain.
- **No fabrication.** Tailoring is grounded in the profile (or real experience the user supplies via
  the gap-interview); the prompt forbids inventing anything.

## Conventions

- TypeScript strict, **NodeNext ESM** → relative imports MUST end in `.js` (e.g. `./config.js`).
- Prettier-clean; run `npm run format` and stage the result before committing.
- Commands: `profile build|update|show` · `find` · `add` · `pipeline` · `status` · `tailor` · `mcp`.
- **Prefilter** (`src/ingest/prefilter.ts`) is deterministic and conservative: it drops only on
  reliable **title/structured** signals (junior-when-senior, on-site-when-remote, clearly-different
  job family). It does NOT substring-match skills/must-haves/dealbreakers against descriptions —
  that fuzzy judgment is the LLM scorer's job (it weighs must-haves/dealbreakers in context). When
  unsure, keep. Users filter results with `--min-score`.
- Sources supported by `find`: Greenhouse, Lever, Ashby (Ashby's posting API is **GET**, not POST).
  `add <url>` ingests arbitrary posting URLs via direct fetch + html-to-text (JS-rendered pages like
  Workday extract poorly — prefer `tailor --text <file>` for those).

## Docs & data

- Design spec + implementation plans: `docs/superpowers/{specs,plans}/`.
- **Never commit personal data.** Gitignored: `profile/*` (except `.gitkeep` + template),
  `companies.yaml`, `leads-urls.txt`/`leads*.md`, `*.db`, `output/`, `.env`.

## Project status & continuing in a fresh session

Built so far (all on `main`): Plans 1–6 + `lapel remove`. Commands: `profile`, `find`, `add`,
`pipeline`, `status`, `tailor`, `mcp`, `leads`, `remove`. ~102 tests, runs on the Pro subscription
(`LAPEL_BACKEND=subscription`, no API key).

To pick up in a new chat: this file auto-loads; then read **`docs/BACKLOG.md`** (what's not built yet,
with origins) and the relevant **`docs/superpowers/plans/`** files. The commit history is the
chronological record. The agentic build process itself (brainstorm → committed spec → sequenced
plans → subagent execution, Opus-plans/Sonnet-builds) is documented in the README's "How this was
built" and the specs/plans — keep using it for new features (write a plan, execute via subagents).

# lapel

> Find relevant jobs and tailor applications from a **living profile** you build once and refine as you go — a local, agentic CLI (plus an MCP server) that keeps you in the loop and never fabricates experience.

`lapel` automates the two grinds of a job search and accelerates the third:

1. **Find** — pull open roles from public ATS APIs (Greenhouse, Lever, Ashby), score each for fit against your profile with an LLM, and track them in a local pipeline.
2. **Tailor** — for a role you choose, generate a tailored résumé summary + cover letter grounded strictly in your real experience.
3. **Learn you** — a one-time interview synthesizes your résumé/LinkedIn into a structured profile, and the tool _deepens_ that profile as you use it (e.g. a gap-interview during tailoring asks about skills a posting stresses but your profile only touches on).

It's also a portfolio project: see [How this was built](#how-this-was-built).

---

## Why

Job hunting splits into "find roles worth applying to" and "tailor each application," and both are tedious in different ways. `lapel` makes finding a fast, deduplicated, _scored_ pipeline you own, and makes tailoring a grounded first draft you refine — while never auto-applying and never inventing experience on your behalf.

## How it works

**Deterministic core, LLM on top. One engine, two front-ends.**

```
  Sources (ATS APIs + URL ingest)                 ┌─────────────────────────┐
  greenhouse / lever / ashby ──► NormalizedJob ──► │  ingest pipeline (pure) │
  add <url>                                        │  dedup → prefilter      │
                                                   └───────────┬─────────────┘
                                          cheap, deterministic │ keeps cost down
                                                               ▼
                                            LLM rubric scoring (Anthropic SDK)
                                                               │
                                                               ▼
                                              SQLite pipeline  (better-sqlite3)
                                       new → interested → applied → rejected
                                                               │
                          ┌────────────────────────────────────┼───────────────────────┐
                          ▼                                                              ▼
                   CLI (commander)                                          MCP server (stdio)
        profile · find · add · pipeline · status · tailor          query_pipeline · find_jobs ·
                                                                      add_jobs · tailor
```

- **Sources** (`src/sources/`, `src/fetcher/`) and the **ingest pipeline** (`src/ingest/`) are pure TypeScript with **no LLM dependency** — fully unit-tested without a network or API key.
- **Scoring** runs a cheap deterministic **prefilter** (location/seniority/dealbreakers/must-haves) _before_ any LLM call, then an LLM **rubric** scores what survives — cost-aware by construction.
- The **CLI** and the **published MCP server** are thin wrappers over the same core: no business logic is duplicated between them.

## Quickstart

> Requires **Node 22** (the native `better-sqlite3` build needs it) and an Anthropic API key.

```bash
git clone <your-fork> lapel && cd lapel
npm install
npm run build

cp .env.example .env                       # add ANTHROPIC_API_KEY
cp companies.example.yaml companies.yaml   # edit your ATS watchlist

# drop your résumé / LinkedIn export (PDFs) into ./profile/
node dist/cli.js profile build             # interview + synthesize your profile

node dist/cli.js find                      # scored, ranked pipeline
node dist/cli.js status <job-id> interested
node dist/cli.js tailor <job-id>           # résumé summary + cover letter + fit notes
```

Add a posting you found elsewhere:

```bash
node dist/cli.js add https://boards.greenhouse.io/acme/jobs/123
```

### Commands

| Command                             | What it does                                                                                         |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `profile build` / `update` / `show` | Build/refine the living profile from your PDFs + an interview                                        |
| `find`                              | Crawl the watchlist, score, dedup, persist, rank (`--no-score` for a key-free prefilter run)         |
| `add <url…>`                        | Ingest specific posting URLs into the same pipeline                                                  |
| `pipeline` / `status <id> <state>`  | View tracked jobs / advance the review gate (`new→interested→applied→rejected`)                      |
| `tailor <id\|--url\|--text>`        | Generate tailored docs (`--opus` for the synthesis tier, `--no-interview` to skip the gap-interview) |
| `mcp`                               | Start the MCP server on stdio                                                                        |

## The living profile

Your profile is **your data, not the repo's** — `profile/` (PDFs + the generated `profile.json`/`profile.md`), `companies.yaml`, `output/`, the `*.db`, and `.env` are all gitignored. The repo ships a `profile.template.json` so every user builds their own.

It's a _living_ artifact: `profile build` is re-runnable, `profile update --note "max commute 30 miles"` edits it, and — the interesting part — the tool **proposes refinements mid-task**. When you `tailor` for a role that leans on a skill your profile only mentions once, it runs a short **gap-interview** ("you mention Kafka once — what did you build with it?") and uses your _real_ answer both to strengthen the draft and (with your confirmation) to enrich the profile. That's also how it stays honest: it asks you for true experience instead of inventing any.

## Use it from Claude Desktop / Code

`lapel` publishes an MCP server exposing the same engine (`query_pipeline`, `find_jobs`, `add_jobs`, `tailor`). Add it to your MCP client config:

```json
{
  "mcpServers": {
    "lapel": {
      "command": "node",
      "args": ["/absolute/path/to/lapel/dist/cli.js", "mcp"],
      "env": { "ANTHROPIC_API_KEY": "sk-ant-..." }
    }
  }
}
```

In the MCP context `tailor` runs non-interactively: it returns the identified gap questions in its result so the calling agent can ask them.

## Ethics

Only **public ATS APIs** (Greenhouse/Lever/Ashby) and postings you explicitly hand it by URL. No scraping of auth-walled or ToS-hostile sources. It **never auto-applies** — generating an application is always an explicit, per-job action you take, and the tool never sends anything to an employer.

## How this was built

This repo is also a demonstration of a disciplined agentic-development workflow — every stage is committed so the process is auditable:

1. **Brainstorm → spec.** Requirements and architecture were explored interactively, then written to a committed design spec ([`docs/superpowers/specs/`](docs/superpowers/specs/)) as the single source of truth.
2. **Spec → plans.** The spec was decomposed into three sequenced, test-driven implementation plans ([`docs/superpowers/plans/`](docs/superpowers/plans/)): foundation, intelligence, surface.
3. **Tiered, subagent-driven execution.** Planning and review ran on a stronger model (Opus); each plan task was implemented by a fresh, cheaper subagent (Sonnet) and reviewed against the plan before the next task — TDD throughout, frequent commits.
4. **Honest course-correction.** Mid-build, the originally specified `@anthropic-ai/claude-agent-sdk` turned out to be unused and to break a clean `npm install` (a `zod` v4 peer conflict). It was dropped in favor of the `@anthropic-ai/sdk` Messages API (structured tool use) plus a _published_ MCP server — see the amendment note atop the spec. The agentic + MCP value is in the design (tool-use loops, the living-profile feedback loop, a published server), not in any one package.
5. **Runtime tiering mirrors the build.** A fast worker model (Sonnet) handles scoring and most tailoring; an opt-in synthesis tier (Opus, via `--opus`/config) handles profile synthesis and final polish.

The commit history, specs, and plans together tell the story of _how_ the tool was designed and built with AI — not just what it does.

## Development

```bash
npm test        # vitest — runs with NO API key (LLM mocked at the boundary)
npm run lint    # eslint (incl. a machine-enforced "core must not import the LLM layer" rule)
npm run build   # tsc → dist/
```

Stack: TypeScript (strict, NodeNext ESM) · `commander` · `zod` · `better-sqlite3` · `unpdf` · `html-to-text` · `@anthropic-ai/sdk` · `@modelcontextprotocol/sdk` · `vitest`.

## License

MIT — see [LICENSE](LICENSE).

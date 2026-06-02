# job-scout — Plan 3: Surface (MCP server, README, polish) Implementation Plan

> **Renamed post-implementation to `lapel`.** This plan keeps the original working name "job-scout" as a historical record; the shipped code uses `lapel`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the portfolio surface — a published stdio MCP server exposing the same engine to Claude Desktop/Code, a first-class README (including the "how this was built" agentic-process section), and CI/polish so the repo is clean and green.

**Architecture:** `src/mcp/server.ts` registers tools that are thin wrappers over the Plan 1–2 core (`ingest`, `getJobs`, `tailorPosting`, `makeScorer`). Tool handlers are factored into testable functions and mocked at the core/LLM boundary. The server runs non-interactively: `tailor` returns identified gap questions in its result rather than blocking on a prompt (Spec §9–§10).

**Tech Stack:** Adds `@modelcontextprotocol/sdk` for the standalone stdio server. Everything else from Plans 1–2.

> **Prereq:** Plans 1 and 2 complete and green. **Read** Spec §9 (MCP), §11 (testing), §12 (README).

---

## File Structure (Plan 3)

| File                        | Responsibility                                           |
| --------------------------- | -------------------------------------------------------- |
| `src/mcp/handlers.ts`       | Pure, testable tool handler functions over the core      |
| `src/mcp/server.ts`         | Register handlers as MCP tools + connect stdio transport |
| `test/mcp/handlers.test.ts` | Handler unit tests (mocked core/LLM)                     |
| Modify: `src/cli.ts`        | register `mcp` command                                   |
| `README.md`                 | Full rewrite (Spec §12)                                  |
| `LICENSE`                   | MIT                                                      |
| `.github/workflows/ci.yml`  | lint + test + build on push/PR                           |
| `docs/DEMO.md`              | copy-paste transcript referenced by README               |

---

## Task 17: Published MCP server

**Files:**

- Create: `src/mcp/handlers.ts`, `src/mcp/server.ts`, `test/mcp/handlers.test.ts`
- Modify: `package.json` (dep), `src/cli.ts` (register `mcp`)

- [ ] **Step 1: Add the MCP SDK**

Run: `npm install @modelcontextprotocol/sdk`

- [ ] **Step 2: Write the failing test for the handlers (mock core + LLM)**

`test/mcp/handlers.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openDb, migrate, upsertJob } from '../../src/db/index.js';
import { makeHandlers } from '../../src/mcp/handlers.js';
import type { Profile } from '../../src/profile/schema.js';
import type { NormalizedJob } from '../../src/sources/types.js';

const profile = {
  preferences: {
    dealbreakers: [],
    mustHave: [],
    seniority: [],
    remote: 'any',
    targetRoles: [],
    locations: [],
    maxCommuteMiles: null,
    minBaseComp: null,
  },
  skills: { core: [], familiar: [] },
  experience: [],
  notes: [],
  basics: { name: 'C' },
} as unknown as Profile;
const job = (id: string): NormalizedJob => ({
  source: 'greenhouse',
  externalId: id,
  company: 'Acme',
  title: 'Senior Eng',
  url: `http://${id}`,
  location: 'Remote',
  remote: true,
  description: 'TS',
  postedAt: null,
  raw: {},
});

describe('mcp handlers', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    db = openDb(':memory:');
    migrate(db);
  });

  it('query_pipeline returns rows as structured json', () => {
    upsertJob(db, job('a'));
    const h = makeHandlers({ db, profile, deps: {} as never });
    const out = h.queryPipeline({});
    expect(out.jobs).toHaveLength(1);
    expect(out.jobs[0].company).toBe('Acme');
  });

  it('add_jobs ingests urls', async () => {
    const fetchPosting = vi.fn().mockResolvedValue({ title: 'Senior Eng', text: 'TS' });
    const h = makeHandlers({ db, profile, deps: { fetchPosting, scorer: null } as never });
    const out = await h.addJobs({ urls: ['http://x'] });
    expect(out.added).toBe(1);
  });

  it('tailor returns gap questions instead of prompting (non-interactive)', async () => {
    const id = upsertJob(db, job('a')).id;
    const identifyGaps = vi
      .fn()
      .mockResolvedValue({ gaps: [{ skill: 'Kafka', question: 'Kafka experience?' }] });
    const synthesize = vi
      .fn()
      .mockResolvedValue({ resumeSummary: 'r', coverLetter: 'c', fitNotes: 'f' });
    const h = makeHandlers({
      db,
      profile,
      deps: { identifyGaps, synthesize, outputDir: '/tmp/js-mcp' } as never,
    });
    const out = await h.tailor({ jobId: id });
    expect(out.gapQuestions).toEqual(['Kafka experience?']);
    expect(out.paths.coverPath).toContain('cover-letter.md');
  });
});
```

- [ ] **Step 3: Run red, implement `src/mcp/handlers.ts`**

```ts
import type Database from 'better-sqlite3';
import { getJobs, getJobById, type JobStatus } from '../db/index.js';
import { ingest, type Scorer } from '../ingest/pipeline.js';
import { adapters, loadWatchlist } from '../sources/index.js';
import { fetchPostingText, urlToNormalizedJob, type PostingText } from '../fetcher/posting.js';
import { tailorPosting } from '../tailor/tailor.js';
import type { Gaps } from '../agent/prompts/tailor-gap-interview.js';
import type { TailorOutput } from '../agent/prompts/tailor.js';
import type { NormalizedJob } from '../sources/types.js';
import type { Profile } from '../profile/schema.js';

export interface HandlerDeps {
  scorer: Scorer | null;
  fetchPosting?: (url: string) => Promise<PostingText>;
  identifyGaps?: (profile: Profile, postingText: string) => Promise<Gaps>;
  synthesize?: (args: {
    profile: Profile;
    postingText: string;
    extra?: string;
  }) => Promise<TailorOutput>;
  outputDir?: string;
  companiesFile?: string;
}

export function makeHandlers(ctx: { db: Database.Database; profile: Profile; deps: HandlerDeps }) {
  const { db, profile, deps } = ctx;

  return {
    queryPipeline(args: { status?: JobStatus; minScore?: number }) {
      return { jobs: getJobs(db, args) };
    },

    async findJobs(args: { limit?: number; minScore?: number }) {
      const watchlist = loadWatchlist(deps.companiesFile!);
      const all: NormalizedJob[] = [];
      for (const e of watchlist) {
        try {
          all.push(...(await adapters[e.source].fetchJobs(e)));
        } catch {
          /* isolate */
        }
      }
      const summary = await ingest(db, all, profile, { score: deps.scorer });
      return { ...summary, jobs: getJobs(db, { minScore: args.minScore, limit: args.limit }) };
    },

    async addJobs(args: { urls: string[] }) {
      const fetchPosting = deps.fetchPosting ?? ((u: string) => fetchPostingText(u));
      const jobs: NormalizedJob[] = [];
      for (const url of args.urls) {
        try {
          jobs.push(urlToNormalizedJob(url, await fetchPosting(url)));
        } catch {
          /* isolate */
        }
      }
      const summary = await ingest(db, jobs, profile, { score: deps.scorer });
      return summary;
    },

    async tailor(args: { jobId?: number; url?: string; text?: string; opus?: boolean }) {
      let company = 'company',
        title = 'role',
        postingText = '';
      let jobId: number | undefined;
      if (args.jobId != null) {
        const job = getJobById(db, args.jobId);
        if (!job) throw new Error(`No job with id ${args.jobId}.`);
        jobId = job.id;
        company = job.company;
        title = job.title;
        postingText = job.description;
      } else if (args.url) {
        const p = deps.fetchPosting ?? ((u: string) => fetchPostingText(u));
        const r = await p(args.url);
        title = r.title ?? title;
        postingText = r.text;
      } else if (args.text) {
        postingText = args.text;
      } else {
        throw new Error('Provide jobId, url, or text.');
      }

      // Non-interactive: identify gaps and RETURN the questions; do not prompt (Spec §10).
      const gapQuestions = deps.identifyGaps
        ? (await deps.identifyGaps(profile, postingText)).gaps.map((g) => g.question)
        : [];

      const result = await tailorPosting({
        db,
        outputDir: deps.outputDir!,
        profile,
        jobId,
        company,
        title,
        postingText,
        synthesize: deps.synthesize!,
      });
      return { paths: result, gapQuestions };
    },
  };
}
```

- [ ] **Step 4: Run green, implement `src/mcp/server.ts`**

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig } from '../config.js';
import { openDb, migrate } from '../db/index.js';
import { loadProfile } from '../profile/store.js';
import { createClient } from '../agent/client.js';
import { makeScorer } from '../scoring/score.js';
import { structuredCall } from '../agent/llm.js';
import { TAILOR_SYSTEM, tailorUserPrompt, TailorOutputSchema } from '../agent/prompts/tailor.js';
import { GAP_SYSTEM, gapUserPrompt, GapsSchema } from '../agent/prompts/tailor-gap-interview.js';
import { makeHandlers } from './handlers.js';

export async function startMcpServer(): Promise<void> {
  const cfg = loadConfig();
  const profile = loadProfile(cfg);
  if (!profile) throw new Error('No profile found. Run `job-scout profile build` first.');
  const db = openDb(cfg.dbPath);
  migrate(db);
  const client = createClient(cfg);

  const h = makeHandlers({
    db,
    profile,
    deps: {
      scorer: makeScorer({ client, model: cfg.models.worker, batchSize: cfg.scoringBatchSize }),
      companiesFile: cfg.companiesFile,
      outputDir: cfg.outputDir,
      identifyGaps: (p, posting) =>
        structuredCall({
          client,
          model: cfg.models.worker,
          system: GAP_SYSTEM,
          user: gapUserPrompt(p, posting),
          toolName: 'emit_gaps',
          schema: GapsSchema,
        }),
      synthesize: ({ profile, postingText, extra }) =>
        structuredCall({
          client,
          model: cfg.models.worker,
          system: TAILOR_SYSTEM,
          user: tailorUserPrompt(profile, postingText, extra),
          toolName: 'emit_tailored',
          schema: TailorOutputSchema,
          maxTokens: 4096,
        }),
    },
  });

  const server = new McpServer({ name: 'job-scout', version: '0.1.0' });

  server.tool(
    'query_pipeline',
    'View tracked jobs in the local pipeline.',
    { status: z.string().optional(), minScore: z.number().optional() },
    async (a) => ({
      content: [{ type: 'text', text: JSON.stringify(h.queryPipeline(a as never), null, 2) }],
    }),
  );

  server.tool(
    'find_jobs',
    'Crawl the ATS watchlist, score, and persist.',
    { limit: z.number().optional(), minScore: z.number().optional() },
    async (a) => ({
      content: [{ type: 'text', text: JSON.stringify(await h.findJobs(a), null, 2) }],
    }),
  );

  server.tool(
    'add_jobs',
    'Ingest specific posting URLs into the pipeline.',
    { urls: z.array(z.string()) },
    async (a) => ({
      content: [{ type: 'text', text: JSON.stringify(await h.addJobs(a), null, 2) }],
    }),
  );

  server.tool(
    'tailor',
    'Generate tailored docs; returns gap questions to optionally ask the user.',
    { jobId: z.number().optional(), url: z.string().optional(), text: z.string().optional() },
    async (a) => ({
      content: [{ type: 'text', text: JSON.stringify(await h.tailor(a), null, 2) }],
    }),
  );

  await server.connect(new StdioServerTransport());
}
```

> Verify the `@modelcontextprotocol/sdk` import paths and `server.tool(...)` signature against the installed version; the `McpServer` + `StdioServerTransport` + `server.tool(name, desc, zodShape, handler)` shape is current. Adapt only if the installed API differs.

- [ ] **Step 5: Register `mcp` in `src/cli.ts`, build, commit**

```ts
import { startMcpServer } from './mcp/server.js';
program
  .command('mcp')
  .description('Start the job-scout MCP server on stdio.')
  .action(async () => {
    await startMcpServer();
  });
```

Run: `npm test && npm run lint && npm run build`
Expected: green / clean / ok.

```bash
git add package.json src/mcp src/cli.ts test/mcp
git commit -m "feat(mcp): publish stdio server (find/add/query/tailor) over the shared engine"
```

---

## Task 18: README + demo

**Files:**

- Create: `LICENSE` (MIT), `docs/DEMO.md`
- Rewrite: `README.md` (Spec §12 — all seven sections)

- [ ] **Step 1: Add `LICENSE` (MIT)** with the user's name and year 2026.

- [ ] **Step 2: Write `docs/DEMO.md`** — a copy-paste transcript of a real session:

````markdown
# Demo

```text
$ job-scout profile build
… interview …
Profile saved to profile/profile.json and profile/profile.md.

$ job-scout find
Fetched 142, added 37, updated 5, dropped 18.
ID  Score  Status  Title                     Company   Location
12  91     new     Senior Full-stack Engineer Acme     Remote - US
…

$ job-scout status 12 interested
Job 12 → interested

$ job-scout tailor 12
This role leans heavily on event-driven systems; your profile mentions it once.
> Tell me about your event-driven work …
Update your profile? You described EventBridge experience… (y/N) y
Tailored docs written to output/acme-senior-full-stack-engineer
```
````

````

> Replace with a real captured run before publishing (no personal data beyond what you choose to show).

- [ ] **Step 3: Rewrite `README.md`** covering all Spec §12 sections. Use this structure (fill with real content):

```markdown
# job-scout

> Find relevant jobs and tailor applications from a living profile you build once and refine as you go.

[what & why — one paragraph + link to docs/DEMO.md]

## Why
Job hunting splits into two grinds: finding roles worth applying to, and tailoring each application.
job-scout automates the first and accelerates the second — while keeping you in the loop and never
fabricating experience.

## How it works
[architecture diagram + the "deterministic core, agent on top / one engine, two front-ends" story]

- **Sources:** public ATS APIs (Greenhouse, Lever, Ashby) + manual URL ingest
- **Scoring:** a cheap deterministic prefilter, then an LLM rubric — cost-aware by design
- **Persistence:** local SQLite pipeline (new → interested → applied → rejected)
- **Tailoring:** resume summary + cover letter + fit notes, grounded strictly in your profile
- **Living profile:** built from your resume/LinkedIn + an interview, and it grows as you use it

## Quickstart
\`\`\`bash
git clone … && cd job-scout
npm install && npm run build
cp .env.example .env   # add ANTHROPIC_API_KEY
cp companies.example.yaml companies.yaml   # edit your watchlist
# drop your resume / LinkedIn PDFs into ./profile/
node dist/cli.js profile build
node dist/cli.js find
node dist/cli.js tailor <job-id>
\`\`\`

## The living profile
[gitignored / per-user; the mid-task feedback loop and gap-interview]

## Use it from Claude Desktop / Code
[how to add the published MCP server: `node dist/cli.js mcp` + config snippet]

## Ethics
Only public ATS APIs; no scraping of auth-walled or ToS-hostile sources; never auto-applies.

## How this was built
This project is also a demonstration of a disciplined agentic development workflow. Every stage is
committed in `docs/` so the process is auditable:

1. **Brainstorm → spec.** Requirements and architecture were explored interactively, then written to
   a committed design spec (`docs/superpowers/specs/`) — the single source of truth.
2. **Spec → plans.** The spec was decomposed into three sequenced, test-driven implementation plans
   (`docs/superpowers/plans/`): foundation, intelligence, surface.
3. **Tiered, subagent-driven execution.** Planning and review ran on **Opus**; each plan task was
   implemented by a fresh **Sonnet** subagent and reviewed against the plan before the next task —
   keeping context tight, cost controlled, and every change scoped and verified (TDD, frequent
   commits).
4. **Runtime tiering mirrors the build.** The app uses a fast worker model (Sonnet) for scoring and
   most tailoring, and an opt-in synthesis tier (Opus) for profile building and final cover-letter
   polish.

The commit history, specs, and plans together tell the story of how the tool was designed and built
with AI — not just what it does.
````

- [ ] **Step 4: Commit**

```bash
git add README.md LICENSE docs/DEMO.md
git commit -m "docs: first-class README, demo transcript, MIT license"
```

---

## Task 19: CI + final polish

**Files:**

- Create: `.github/workflows/ci.yml`
- Verify: `package.json` metadata, `schema.sql` copy in build, full green

- [ ] **Step 1: Add CI**

`.github/workflows/ci.yml`:

```yaml
name: ci
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npm run build
```

> Tests must run **without** `ANTHROPIC_API_KEY` (everything LLM-touching is mocked at the boundary). CI sets no secret. If any test reaches the network or requires a key, fix the test — that's a boundary leak.

- [ ] **Step 2: Verify metadata + build artifacts**

Confirm `package.json` has `description`, `license: "MIT"`, `repository`, `keywords`, and that `build` copies `schema.sql` (from Plan 1 Task 3). Add `files: ["dist", "src/db/schema.sql"]` if you intend to publish.

- [ ] **Step 3: Full green gate**

Run:

```bash
npm ci
npm run lint
npm test
npm run build
node dist/cli.js --help
```

Expected: all clean; help lists `profile`, `find`, `add`, `pipeline`, `status`, `tailor`, `mcp`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml package.json
git commit -m "ci: lint+test+build on push/PR; finalize package metadata"
```

---

## Plan 3 Self-Review (run before completion)

- [ ] **Spec coverage:** §9 MCP server with `find_jobs`/`add_jobs`/`query_pipeline`/`tailor` over the shared core ✓ (Task 17), non-interactive `tailor` returns gap questions ✓, §12 README all seven sections incl. "how this was built" ✓ (18), §11 tests run keyless in CI ✓ (19). (`score_job` single-posting tool from §9 is optional; add as a thin wrapper over `makeScorer` on a one-item batch if desired — note left for the implementer.)
- [ ] **Placeholder scan:** README/DEMO contain bracketed prose guidance to fill with real captured output — that's authoring guidance, not code placeholders; all code steps are runnable.
- [ ] **Type consistency:** handler names (`queryPipeline`, `findJobs`, `addJobs`, `tailor`) and `HandlerDeps` match between `handlers.ts`, its test, and `server.ts`.
- [ ] **One engine:** MCP handlers call the same `ingest`, `getJobs`, `tailorPosting`, `makeScorer` as the CLI — no duplicated business logic.

**Exit criteria:** CI green; `job-scout mcp` starts and is addable to Claude Desktop; README renders well on GitHub; repo contains no personal data (profile + companies.yaml gitignored).

---

## Optional follow-ups (explicitly out of scope — do NOT build now)

- `score_job` single-posting MCP tool (thin wrapper over a one-item scorer batch).
- LLM field-extraction in `add` (company/location/title from posting text).
- Text/CSV batch inputs for `add` (the ingest core already supports it via a new `NormalizedJob[]` builder).
- PDF export of tailored docs.
- Literal fetch-MCP consumption for retrieval (if the user requires it over direct fetch).

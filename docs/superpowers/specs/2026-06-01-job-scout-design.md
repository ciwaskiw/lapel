# job-scout — Design Spec

**Date:** 2026-06-01
**Status:** Approved for implementation planning
**Author:** Design via Claude Opus 4.8 (brainstorming). Intended implementer: Claude Sonnet 4.6 (separate session).

> **Note to implementer:** This spec is written to be self-contained. You will not have the
> brainstorming conversation in context. Every command signature, schema, and module
> responsibility you need is specified here. Where this spec says "exact," treat it as a contract.
> Where it says "implementer's discretion," choose the simplest thing that satisfies the surrounding
> requirements and follow existing patterns in the repo. When in doubt, prefer fewer moving parts.

---

## 1. Problem & Goals

`job-scout` is a local, agentic CLI that helps a single job-seeker (the repo owner) do two things:

1. **Find** — pull open positions from public ATS APIs (and ingest postings the user supplies by
   URL), score each for fit against the user's profile, and persist them to a local pipeline.
2. **Tailor** — for a chosen posting, generate a tailored resume summary and cover letter grounded
   strictly in the user's real experience.

It is also a **portfolio project**. Two audiences matter equally: the user (a real daily tool during
their job search) and a GitHub visitor evaluating the user's engineering and agentic-AI skills.
Therefore the README and the visible development process are first-class deliverables, not
afterthoughts.

### Success criteria

- A new user can clone, set an API key, run `profile build`, and get scored jobs from `find` in
  under ~10 minutes of setup.
- `find` and `add` produce a ranked, de-duplicated pipeline in SQLite without re-showing dismissed
  jobs.
- `tailor` produces resume + cover-letter Markdown that contains no fabricated experience.
- The codebase reads as clean, well-bounded, tested TypeScript.
- The README clearly explains the problem, the architecture, and _how the project was built with AI_.

### Non-goals (v1)

- No LinkedIn/Indeed scraping (brittle, ToS-hostile, bad optics for a public repo).
- No web UI; CLI + published MCP server only.
- No PDF export of tailored docs (Markdown only).
- No multi-user accounts or cloud sync; everything is local to one machine.
- No auto-application/auto-submit. The tool never sends anything to an employer.

---

## 2. Core Principles (binding)

1. **Deterministic core, agent on top.** `sources/`, `profile/` (storage + schema), `db/`, and the
   ingestion/prefilter logic are pure TypeScript with **no LLM dependency** and are unit-testable
   without network or API keys. The LLM/agent layer sits above and calls into them.
2. **One engine, two front-ends.** The CLI and the published MCP server are thin orchestrators over
   the same core modules. No business logic lives in `cli.ts` or `mcp/server.ts`.
3. **Human-in-the-loop gate.** `find`/`add` and `tailor` **never auto-chain**. `find`/`add` only
   discover, score, and persist (`status=new`). Generating any application document is always an
   explicit, per-job action the user initiates. The user reviews and advances job status between the
   two stages.
4. **No fabrication.** Tailoring prompts forbid inventing employers, titles, dates, or skills.
   Every claim in generated documents must trace to the profile — or to real experience the user
   supplies on the spot via the `tailor` gap-interview (Section 10). When evidence is thin and the
   user can't supply more, the model states the gap rather than inventing.
5. **Cost-aware by construction.** A cheap deterministic prefilter runs before any LLM scoring.
   Model tiering (Section 8) keeps routine work on Sonnet and reserves Opus for synthesis the user
   opts into.
6. **The living profile is the user's data, not the repo's.** The user's PDFs and the built
   profile artifacts and generated output are **all gitignored** (a public portfolio repo must
   never contain the author's actual resume/LinkedIn data). `.gitignore` ignores `profile/*`
   except `profile/.gitkeep` and `profile/profile.template.json`, plus `companies.yaml`,
   `output/`, `*.db`, and `.env`. The repo ships templates so each user builds their own.

---

## 3. Commands (exact CLI surface)

Binary name: `job-scout` (via `package.json` `bin`). All commands are subcommands under it,
implemented with `commander`.

```
job-scout profile build
    Extract text from PDFs in ./profile/, run an interactive interview, synthesize
    ./profile/profile.json + ./profile/profile.md. Re-runnable (merges with existing).

job-scout profile update [--note "<text>"]
    Apply an incremental change to the profile. With --note, the agent integrates the freeform
    note (e.g. "max commute 30 miles") into the structured profile after confirmation. Without
    --note, runs a short targeted interview for the field(s) the user names.

job-scout profile show
    Print profile.md to stdout (no LLM). Convenience/inspection command.

job-scout find [--limit <n>] [--min-score <0-100>] [--no-score] [--keep-dropped]
    Crawl the ATS watchlist (./companies.yaml), normalize, dedup vs DB, prefilter, score,
    persist (status=new), print a ranked table. --no-score skips LLM scoring (prefilter only).
    --keep-dropped additionally prints the prefilter-dropped jobs with their drop reasons
    (not persisted). Dropped count + reasons are always logged to stderr regardless.

job-scout add <url...> | --urls <file> [--keep-dropped]
    Ingest specific posting URLs into the same pipeline as find (fetch -> normalize -> dedup ->
    prefilter -> score -> persist status=new). Accepts URLs as args and/or a newline-delimited
    file. --keep-dropped behaves as in find. v1 supports URLs only; the ingest core is structured
    so text/CSV inputs can be added later (see Section 6.4).

job-scout pipeline [--status <new|interested|applied|rejected>] [--min-score <n>]
    View tracked jobs as a table, newest/highest-score first. Read-only (no LLM).

job-scout status <job-id> <new|interested|applied|rejected>
    Advance a job's status. This is the human review gate between find and tailor.

job-scout tailor <job-id | url | --text <file>> [--opus] [--no-interview]
    Generate resume-summary.md + cover-letter.md + fit-notes.md for one posting into
    ./output/<slug>/, and record paths in the applications table. Input may be a DB job id, a
    raw URL, or freeform text from a file. --opus forces the Opus tier for synthesis. By default
    runs a bounded gap-interview (Section 10) when the posting emphasizes skills the profile
    covers thinly; --no-interview skips it and tailors from the profile as-is.

job-scout mcp
    Start the job-scout MCP server on stdio (see Section 9).
```

Global: `--help`/`--version` from commander. Exit non-zero on error with a readable message
(no stack traces unless `JOB_SCOUT_DEBUG=1`).

---

## 4. Project Layout

```
job-scout/
├── README.md                   # portfolio centerpiece (Section 11)
├── package.json                # bin: { "job-scout": "dist/cli.js" }, type: module
├── tsconfig.json               # NodeNext, ES2022, strict
├── .env.example                # ANTHROPIC_API_KEY, optional model overrides
├── .gitignore                  # profile/* (except .gitkeep + template), companies.yaml,
│                               #   output/, *.db, .env, dist/, node_modules/
├── companies.example.yaml      # sample ATS watchlist (real one: companies.yaml, gitignored)
├── profile/
│   ├── .gitkeep                # the user drops their resume/linkedin PDFs here
│   └── profile.template.json   # shape reference for a built profile (committed)
├── src/
│   ├── cli.ts                  # commander wiring only; delegates to command handlers
│   ├── config.ts               # env loading, paths, model selection (Section 8)
│   ├── commands/               # one file per subcommand; thin orchestration
│   │   ├── profile.ts          # build / update / show
│   │   ├── find.ts             # find + add share ingest; this wires the watchlist path
│   │   ├── add.ts
│   │   ├── pipeline.ts         # pipeline + status
│   │   └── tailor.ts
│   ├── sources/                # ATS adapters -> NormalizedJob (no LLM)
│   │   ├── types.ts            # NormalizedJob, SourceAdapter interface
│   │   ├── greenhouse.ts
│   │   ├── lever.ts
│   │   ├── ashby.ts
│   │   └── index.ts            # registry + dispatch by source/url
│   ├── ingest/                 # shared normalize -> dedup -> prefilter -> score -> persist
│   │   ├── pipeline.ts         # the one ingestion core used by find + add
│   │   ├── prefilter.ts        # deterministic gating (no LLM)
│   │   └── dedup.ts
│   ├── profile/
│   │   ├── schema.ts           # zod Profile schema (Section 5)
│   │   ├── pdf.ts              # PDF text extraction (unpdf)
│   │   ├── build.ts            # interview + synthesis orchestration
│   │   └── store.ts            # read/write profile.json + render profile.md
│   ├── db/
│   │   ├── schema.sql          # DDL (Section 7)
│   │   ├── migrate.ts          # idempotent migration runner
│   │   └── index.ts            # better-sqlite3 wrapper + typed queries
│   ├── scoring/
│   │   ├── rubric.ts           # the scoring rubric + zod output schema (Section 6.3)
│   │   └── score.ts            # LLM scoring call + validation/repair
│   ├── tailor/
│   │   └── tailor.ts           # fetch/extract -> synthesize -> write -> track
│   ├── agent/
│   │   ├── client.ts           # Agent SDK setup, model selection, MCP consumption (fetch)
│   │   ├── tools/              # in-process SDK tools (zod-typed)
│   │   │   └── update-profile.ts   # lets find/tailor propose profile additions
│   │   └── prompts/            # system prompts as string modules
│   │       ├── interview.ts
│   │       ├── synthesize-profile.ts
│   │       ├── score.ts
│   │       ├── tailor.ts
│   │       └── tailor-gap-interview.ts  # identify thin-coverage gaps + generate questions
│   └── mcp/
│       └── server.ts           # published job-scout MCP server (Section 9)
├── test/                       # vitest; mirrors src/ structure; fixtures/ for recorded JSON
│   └── fixtures/
└── docs/
    └── superpowers/specs/2026-06-01-job-scout-design.md   # this file
```

**Module dependency rule (machine-enforced):** `sources/`, `db/`, `profile/store.ts`,
`profile/schema.ts`, `ingest/prefilter.ts`, `ingest/dedup.ts`, `scoring/rubric.ts` must not import
anything from `agent/` or the Anthropic SDK. Enforce this in ESLint via `eslint-plugin-boundaries`
(or `no-restricted-imports` zones) so the boundary is checked in CI/lint, not just by review. A
violation must fail lint.

---

## 5. The Living Profile

### 5.1 Lifecycle

- **Source inputs:** PDFs the user places in `./profile/` (e.g. resume, LinkedIn export). `pdf.ts`
  extracts raw text with `unpdf`.
- **Build:** `profile build` feeds extracted text to an interview (agent asks about target roles,
  locations + max commute radius, remote preference, comp floor, must-have technologies,
  dealbreakers, and gaps the resume doesn't cover), then synthesizes a `Profile` object validated
  against the zod schema. Writes `profile.json` (machine) + `profile.md` (human).
- **Update:** `profile update` edits the existing profile incrementally (targeted interview or a
  `--note`). Re-running `build` merges rather than clobbers (preserve user-confirmed fields unless
  the user changes them).
- **Living refinement (the feedback loop):** an `update_profile` agent tool (Section 10) lets `find`
  and `tailor` _propose_ additions mid-task — e.g. a job outside the user's commute prompts "record
  max commute 30 mi?" The change is written **only after explicit user confirmation**.
- **Gap-interview during tailor:** when a posting heavily emphasizes a skill the profile covers
  thinly or not at all, `tailor` interviews the user to surface real, specific experience, then uses
  the answers both to strengthen the tailored documents and (via `update_profile`) to offer to
  enrich the profile. Full behavior in Section 10. This is the primary way the profile grows from
  "resume bullets" into a deep, evidence-rich record over a job search.

### 5.2 Profile schema (zod, `profile/schema.ts`)

Exact required shape. Fields beyond these are allowed under `extras` but core consumers read only
these. All string arrays default to `[]`.

```ts
const Profile = z.object({
  version: z.literal(1),
  updatedAt: z.string(), // ISO 8601
  basics: z.object({
    name: z.string(),
    headline: z.string(), // e.g. "Full-stack engineer, 8y, TS/Node/AWS"
    yearsExperience: z.number(),
    summary: z.string(), // 2-4 sentence professional summary
  }),
  skills: z.object({
    core: z.array(z.string()), // strongest, e.g. ["TypeScript","DynamoDB","CDK"]
    familiar: z.array(z.string()),
  }),
  experience: z.array(
    z.object({
      company: z.string(),
      title: z.string(),
      start: z.string(), // "YYYY-MM"
      end: z.string().nullable(), // null = present
      highlights: z.array(z.string()), // concrete, resume-grade bullets
      tech: z.array(z.string()),
    }),
  ),
  preferences: z.object({
    targetRoles: z.array(z.string()), // e.g. ["Senior Full-stack Engineer","Staff Eng"]
    seniority: z.array(z.string()), // e.g. ["senior","staff"]
    locations: z.array(z.string()), // e.g. ["Remote (US)","Boston, MA"]
    remote: z.enum(['remote', 'hybrid', 'onsite', 'any']),
    maxCommuteMiles: z.number().nullable(),
    minBaseComp: z.number().nullable(), // USD/year
    mustHave: z.array(z.string()), // dealmakers, e.g. ["TypeScript"]
    dealbreakers: z.array(z.string()), // exclude terms, e.g. ["on-call 24/7","PHP"]
  }),
  notes: z.array(z.string()), // freeform, from updates/feedback loop
  extras: z.record(z.unknown()).optional(),
});
```

`profile.md` is a deterministic render of this object (no LLM) for human reading and for stuffing
into prompts where a prose profile is more useful than JSON.

---

## 6. Sources, Ingestion, Scoring

### 6.1 ATS adapters (`sources/`)

Each adapter implements a common interface and returns `NormalizedJob[]`. No LLM. Public,
no-auth endpoints:

- **Greenhouse:** `GET https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true`
- **Lever:** `GET https://api.lever.co/v0/postings/{slug}?mode=json`
- **Ashby:** `POST https://api.ashbyhq.com/posting-api/job-board/{slug}` (JSON body per Ashby's
  public posting API; implementer verifies exact shape against a live board and records a fixture).

`NormalizedJob` (exact):

```ts
type NormalizedJob = {
  source: 'greenhouse' | 'lever' | 'ashby' | 'url';
  externalId: string; // stable id from the source; for url ingest, a hash of the URL
  company: string;
  title: string;
  url: string;
  location: string | null;
  remote: boolean | null; // best-effort from location/flags
  description: string; // plain text (strip HTML)
  postedAt: string | null; // ISO 8601 if available
  raw: unknown; // original payload, persisted as raw_json
};
```

`companies.yaml` (gitignored; `companies.example.yaml` committed) lists watchlist entries:

```yaml
companies:
  - { source: greenhouse, slug: examplecorp }
  - { source: lever, slug: examplelabs }
  - { source: ashby, slug: exampleai }
```

Per-company failures are isolated: log a warning, continue. A failed company never aborts the run.
HTTP uses Node's built-in `fetch` with a small retry/backoff helper (e.g. 3 tries, exponential).

### 6.2 Ingestion core (`ingest/pipeline.ts`)

One function used by both `find` and `add`:

```
ingest(jobs: NormalizedJob[], opts) ->
  dedup(vs DB by (source, externalId) and by normalized url)
  -> prefilter(profile)        // deterministic; drops obvious non-matches (conservative)
  -> score(profile)            // LLM, unless --no-score; batched
  -> persist(status="new")     // upsert; never overwrite a non-"new" status on re-ingest
  -> return summary(added, updated, skipped, ranked)
```

`find` builds the `NormalizedJob[]` from the watchlist adapters; `add` builds it from URLs (fetch
via the consumed fetch MCP, then a light extraction into `NormalizedJob`). Both then call the same
`ingest`.

### 6.3 Prefilter (`ingest/prefilter.ts`, deterministic, unit-tested)

Drops a job before LLM scoring when, per the profile's `preferences`:

- `remote` preference is `onsite`/`hybrid`/`remote` and the job clearly conflicts; or `any` passes.
- the title clearly fails seniority (e.g. profile wants senior/staff but title is "Intern"/"Junior")
  — keyword-based, conservative (only drop on confident mismatch).
- the description/title contains a `dealbreakers` term.
- `mustHave` terms are entirely absent from title+description.

Conservative by design: when unsure, keep the job (let scoring decide). Returns kept + reason-tagged
dropped lists. Dropped jobs are **never persisted**; their count and per-job reasons are **always
logged to stderr**. The `--keep-dropped` flag additionally prints the dropped list (with reasons) to
stdout so the user can spot an over-aggressive prefilter or a bad profile preference.

### 6.4 Scoring (`scoring/`, LLM)

Batched scoring call(s) over kept jobs. Output is validated against a zod schema; one repair retry
on invalid JSON, then skip-with-warning. Per-job result (exact):

```ts
const JobScore = z.object({
  score: z.number().min(0).max(100),
  matchedSkills: z.array(z.string()),
  missingSkills: z.array(z.string()),
  reasons: z.string(), // 1-3 sentences, why this score
});
```

The rubric (in `scoring/rubric.ts`, included verbatim in the prompt) weights: skills/tech overlap
with `skills.core`, seniority fit, location/remote fit, and alignment with `preferences.targetRoles`.
Scoring uses the **worker tier** (Sonnet) by default. Batch to control cost: a config constant
`SCORING_BATCH_SIZE` defaults to **10** jobs/call. Per-item reliability is handled by the
zod-validate + one-repair-retry path above (a malformed item degrades to skip-with-warning, it does
not fail the batch). Do not score per-job — too costly over a large watchlist.

> **Future-proofing for `add` inputs:** the ingest core takes `NormalizedJob[]`, so adding text- or
> CSV-based batch inputs later means writing a new builder that emits `NormalizedJob[]` — no change
> to dedup/prefilter/score/persist. Do not special-case URL ingest deeper than the builder.

---

## 7. Persistence (SQLite via `better-sqlite3`)

DB file: `./job-scout.db` (gitignored). Migrations are idempotent (run on every command that needs
the DB; `CREATE TABLE IF NOT EXISTS`). `schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS jobs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source        TEXT NOT NULL,
  external_id   TEXT NOT NULL,
  company       TEXT NOT NULL,
  title         TEXT NOT NULL,
  url           TEXT NOT NULL,
  location      TEXT,
  remote        INTEGER,                 -- 0/1/NULL
  description   TEXT NOT NULL,
  score         INTEGER,                 -- NULL until scored
  matched_skills TEXT,                   -- JSON array
  missing_skills TEXT,                   -- JSON array
  score_reasons TEXT,
  status        TEXT NOT NULL DEFAULT 'new',  -- new|interested|applied|rejected
  posted_at     TEXT,
  first_seen    TEXT NOT NULL,           -- ISO 8601
  raw_json      TEXT NOT NULL,
  UNIQUE(source, external_id)
);

CREATE TABLE IF NOT EXISTS applications (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id          INTEGER NOT NULL REFERENCES jobs(id),
  resume_path     TEXT NOT NULL,
  cover_path      TEXT NOT NULL,
  fit_notes_path  TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  UNIQUE(job_id)
);
```

Re-ingest is an UPSERT on `(source, external_id)` that refreshes mutable fields (title, description,
score) but **must not** reset a `status` that has moved past `new`.

---

## 8. Model Tiering & Config (`config.ts`)

- **Worker tier (default):** `claude-sonnet-4-6` — interview turns, scoring, default tailoring,
  field extraction for `add`. Chosen for cost/speed (the user is actively job-searching).
- **Synthesis tier (opt-in):** `claude-opus-4-8` — profile synthesis and `tailor --opus` for
  final cover-letter polish.
- Overridable via env: `JOB_SCOUT_MODEL_WORKER`, `JOB_SCOUT_MODEL_SYNTH`. `ANTHROPIC_API_KEY`
  required. `.env` loaded (e.g. via `dotenv`); `.env.example` documents all vars.

`config.ts` also centralizes paths (profile dir, output dir, db path, companies.yaml) so tests can
inject temp dirs.

---

## 9. Published MCP Server (`mcp/server.ts`)

`job-scout mcp` starts a stdio MCP server exposing the same engine as tools, so the project is usable
from Claude Desktop/Code, not just the CLI. Tools (thin wrappers over core modules; zod input
schemas):

- `find_jobs({ limit?, minScore?, score? })` — runs the watchlist ingest, returns ranked jobs.
- `add_jobs({ urls: string[] })` — ingests URLs into the pipeline.
- `score_job({ url?, text? })` — scores a single posting against the profile (no persist).
- `query_pipeline({ status?, minScore? })` — reads the pipeline.
- `tailor({ jobId?, url?, text?, opus? })` — generates and persists tailored docs. Runs
  **non-interactively** (no TTY in the MCP context): it tailors from the profile as-is and includes
  the identified gap questions (Section 10) in its result so the calling agent can ask them and, if
  the user elaborates, call `tailor` again or `update_profile`.

The README documents adding the server to Claude Desktop/Code config. The MCP server and CLI share
identical core calls — no duplicated logic.

---

## 10. Agent Layer & the Feedback Loop

- `agent/client.ts` configures the Claude Agent SDK: model selection (Section 8), and **consumes the
  official `fetch` MCP** so `add`/`tailor` robustly pull posting text from a URL.
- In-process SDK tool `update_profile` (zod-typed) is available during `find` and `tailor`. When the
  agent notices a signal worth recording (a commute conflict the user flags, a recurring missing
  skill, a stated preference), it calls `update_profile` to **propose** a change. The CLI surfaces a
  confirmation prompt; the profile is written only on explicit user "yes." This is the "living
  profile" loop.
- **Gap-interview during `tailor` (default on; `--no-interview` to skip):**
  1. After fetching the posting and loading the profile, the agent identifies the posting's
     **high-emphasis requirements** (skills/qualifications the posting stresses) and cross-references
     the profile. A requirement is a "gap" when it is emphasized by the posting but **absent or only
     thinly evidenced** in the profile (e.g. mentioned once with no supporting highlight).
  2. The agent asks the user targeted questions about the **top N gaps** (N capped, default **3**) —
     e.g. "This role leans heavily on Kafka; your profile mentions it once. Have you run Kafka in
     production — scale, your role, what you built?" Questions are skipped for gaps the user can't
     speak to; the user may answer "skip"/"no experience."
  3. Answers feed synthesis directly, so the tailored resume/cover reflect the elaborated, **real**
     experience. This is how `tailor` stays honest under pressure: it asks for true experience rather
     than inventing it — a direct application of Principle 4, not an exception to it. The model never
     promotes a "skip"/"no experience" answer into a claim.
  4. For each substantive answer, the agent offers (via `update_profile`, confirmed) to persist the
     elaboration into the relevant `experience[].highlights` or `skills`, so the next tailor starts
     richer.
  - **Non-interactive contexts (MCP server, `--no-interview`, no TTY):** the interview does **not**
    block. Instead `tailor` proceeds from the profile as-is and returns the identified gap questions
    in its result (Section 9) so the caller (e.g. an agent in Claude Desktop) can choose to ask them.
- Prompts live in `agent/prompts/` as plain string modules so they're diffable and reviewable:
  `interview.ts` (profile build), `synthesize-profile.ts`, `score.ts`, `tailor.ts`, and
  `tailor-gap-interview.ts` (gap identification + question generation). The tailor prompts contain
  the no-fabrication contract (Principle 4) explicitly.

---

## 11. Error Handling & Testing

**Error handling**

- Source/network failures isolated per company; retry/backoff on transient HTTP errors.
- LLM structured outputs zod-validated with one repair retry, then graceful skip + warning.
- Missing/!built profile → friendly message pointing to `profile build` (no stack trace).
- Idempotent migrations; UPSERTs never clobber human-set status.
- `JOB_SCOUT_DEBUG=1` enables verbose logs/stack traces.

**Testing (TDD; vitest)**

- `sources/` adapters tested against **recorded JSON fixtures** in `test/fixtures/` (no live network
  in tests).
- `ingest/prefilter.ts`, `ingest/dedup.ts`, `profile/schema.ts`, `profile/store.ts` (md render),
  `db/` (against a temp/in-memory SQLite file) — pure unit tests, no API key needed.
- Scoring/tailor/interview: the LLM is mocked at the tool/function boundary; assert on prompt
  assembly, zod validation, repair-retry behavior, and persistence side-effects.
- A smoke test that `cli.ts` wires every subcommand and prints help.
- Core deterministic modules must pass with **no `ANTHROPIC_API_KEY` set**.

---

## 12. README (first-class deliverable)

Required sections:

1. **What & why** — the problem, one-paragraph pitch, a short demo (asciinema or copy-paste
   transcript).
2. **Architecture** — a diagram and the "deterministic core, agent on top / one engine, two
   front-ends" story.
3. **Quickstart** — clone, `.env`, drop PDFs in `profile/`, `profile build`, `find`, `tailor`.
4. **The living profile** — what it is, that it's gitignored/per-user, and the mid-task feedback loop.
5. **Using it from Claude Desktop/Code** — the published MCP server setup.
6. **Ethics note** — only public ATS APIs; no scraping of auth-walled/ToS-hostile sources; the tool
   never auto-applies.
7. **How this was built** — the agentic development process itself: brainstorm → committed spec →
   implementation plan → tiered execution (**Opus for design/planning, Sonnet for implementation to
   control cost**), plus the in-app model tiering. This section is deliberate portfolio evidence of
   how the author works with AI.

---

## 13. Tech Stack (pinned choices)

- Runtime: Node 20+ (built-in `fetch`), TypeScript strict, ESM (`type: module`, NodeNext).
- CLI: `commander`. Schemas/validation: `zod`. DB: `better-sqlite3`. PDF: `unpdf`. YAML: `yaml`.
  Env: `dotenv`. Agent: `@anthropic-ai/claude-agent-sdk`. Consumed MCP: official `fetch` server.
- Dev: `vitest`, `tsx` (run TS directly in dev), **plain `tsc`** for the `dist/` build (no bundler —
  legible toolchain, avoids native-module bundling friction with `better-sqlite3`; NodeNext requires
  explicit `.js` extensions on relative imports). Lint/format: **ESLint + Prettier**, with a
  machine-enforced import-boundary rule (see Section 4).

---

## 14. Build Order (suggested; the implementation plan will refine this)

1. Repo scaffold: package.json, tsconfig, .gitignore, .env.example, config.ts, empty command wiring.
2. `db/` (schema, migrate, typed queries) + tests.
3. `profile/` (schema, pdf, store, md render) + tests. `profile build`/`show` (interview can be
   stubbed first, then wired to the agent).
4. `sources/` adapters + fixtures + tests.
5. `ingest/` (dedup, prefilter) + tests; wire `find` (with `--no-score`) end-to-end.
6. `scoring/` + tests; enable scoring in `find`.
7. `add` (URL ingest via fetch MCP) reusing the ingest core.
8. `pipeline` + `status`.
9. `tailor` + the no-fabrication prompt + output writing/tracking (start with `--no-interview`).
10. `update_profile` feedback-loop tool, then the gap-interview in `tailor` (Section 10) on top of it.
11. `mcp/server.ts` published server over the same core.
12. README (all sections) + demo transcript.

# job-scout — Plan 1: Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the deterministic core of job-scout — config, SQLite persistence, the living-profile schema/store/PDF extraction, ATS source adapters, the ingest/dedup/prefilter pipeline, and the `find --no-score`, `pipeline`, and `status` commands — all testable with **no Anthropic API key**.

**Architecture:** A TypeScript ESM CLI (`commander`) over focused, single-responsibility modules. The deterministic core (`config`, `db`, `profile/{schema,store,pdf}`, `sources`, `ingest`) has **no LLM dependency** and is fully unit-tested. The ingest pipeline takes a `Scorer` by dependency injection so Plan 2 can plug in LLM scoring without touching the core. An ESLint boundary rule machine-enforces that core modules never import `agent/` or the Anthropic SDK.

**Tech Stack:** Node 20+, TypeScript (strict, NodeNext ESM), `commander`, `zod`, `better-sqlite3`, `unpdf`, `yaml`, `html-to-text`, `dotenv`; `vitest` + `tsx`; ESLint + Prettier with `eslint-plugin-boundaries`.

> **Spec:** `docs/superpowers/specs/2026-06-01-job-scout-design.md`. Read it first. This plan implements Sections 2–7 (core), the deterministic parts of 3 (commands), 8 (config), and 13 (stack). LLM/agent/MCP work is Plans 2–3.
>
> **NodeNext note:** every relative import MUST end in `.js` (e.g. `import { loadConfig } from './config.js'`) even though the source file is `.ts`. This is required, not optional.
>
> **Conventions for every task:** write the test first, run it red, implement, run it green, commit. Use `git -c user.name="Chris Iwaskiw" -c user.email="christopher.iwaskiw@gmail.com" commit` only if a global identity isn't set (check with `git config user.name`). Commit messages use Conventional Commits.

---

## File Structure (Plan 1)

| File | Responsibility |
|------|----------------|
| `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `eslint.config.js`, `.prettierrc`, `vitest.config.ts` | Project scaffold + toolchain |
| `companies.example.yaml` | Sample ATS watchlist (committed) |
| `profile/.gitkeep`, `profile/profile.template.json` | Profile dir placeholder + shape reference |
| `src/cli.ts` | commander wiring only |
| `src/config.ts` | Env, paths, model names, constants |
| `src/db/schema.sql`, `src/db/migrate.ts`, `src/db/index.ts` | SQLite schema + typed queries |
| `src/profile/schema.ts` | zod `Profile` schema + types |
| `src/profile/store.ts` | load/save profile.json, render profile.md |
| `src/profile/pdf.ts` | PDF text extraction (unpdf) + text cleaning |
| `src/sources/types.ts` | `NormalizedJob`, `SourceAdapter`, `WatchlistEntry` |
| `src/sources/http.ts` | `fetchJson` with retry/backoff + `stripHtml` |
| `src/sources/greenhouse.ts`, `lever.ts`, `ashby.ts` | ATS adapters |
| `src/sources/index.ts` | adapter registry + watchlist loader |
| `src/ingest/dedup.ts` | drop jobs already in DB |
| `src/ingest/prefilter.ts` | deterministic gating vs profile prefs |
| `src/ingest/pipeline.ts` | `ingest()` core (dedup → prefilter → score(injected) → persist) |
| `src/ui/table.ts` | console table formatter |
| `src/commands/find.ts`, `pipeline.ts` | command handlers |
| `test/**` | vitest specs mirroring `src/`; `test/fixtures/` recorded JSON + sample PDF |

---

## Task 1: Project scaffold + toolchain

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `eslint.config.js`, `.prettierrc`, `vitest.config.ts`, `src/cli.ts`, `companies.example.yaml`, `profile/.gitkeep`, `profile/profile.template.json`, `README.md` (stub)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "job-scout",
  "version": "0.1.0",
  "description": "Agentic CLI that finds and tailors job applications from your living profile.",
  "type": "module",
  "bin": { "job-scout": "dist/cli.js" },
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc",
    "dev": "tsx src/cli.ts",
    "start": "node dist/cli.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "format": "prettier --write ."
  },
  "dependencies": {
    "better-sqlite3": "^11.3.0",
    "commander": "^12.1.0",
    "dotenv": "^16.4.5",
    "html-to-text": "^9.0.5",
    "unpdf": "^0.12.1",
    "yaml": "^2.5.1",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/html-to-text": "^9.0.4",
    "@types/node": "^22.5.0",
    "@typescript-eslint/eslint-plugin": "^8.5.0",
    "@typescript-eslint/parser": "^8.5.0",
    "eslint": "^9.10.0",
    "eslint-config-prettier": "^9.1.0",
    "eslint-plugin-boundaries": "^5.0.0",
    "prettier": "^3.3.3",
    "tsx": "^4.19.0",
    "typescript": "^5.6.2",
    "vitest": "^2.0.5"
  }
}
```

> Versions are floors; if `npm install` resolves newer compatible majors, that's fine. Anthropic SDKs are intentionally **not** here — they arrive in Plan 2.

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "rootDir": "src",
    "outDir": "dist",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": false,
    "sourceMap": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `.gitignore`**

```gitignore
node_modules/
dist/
*.db
.env
output/
# the user's profile is private; only keep the placeholder + template
profile/*
!profile/.gitkeep
!profile/profile.template.json
# the user's real watchlist is private; ship the example only
companies.yaml
```

- [ ] **Step 4: Create `.env.example`, `.prettierrc`, `companies.example.yaml`, `profile/.gitkeep`, `profile/profile.template.json`, `README.md`**

`.env.example`:
```bash
# Required for Plan 2+ (LLM features). Not needed for Plan 1.
ANTHROPIC_API_KEY=
# Optional model overrides
# JOB_SCOUT_MODEL_WORKER=claude-sonnet-4-6
# JOB_SCOUT_MODEL_SYNTH=claude-opus-4-8
# JOB_SCOUT_DEBUG=1
```

`.prettierrc`:
```json
{ "singleQuote": true, "semi": true, "printWidth": 100, "trailingComma": "all" }
```

`companies.example.yaml`:
```yaml
# Copy to companies.yaml and edit. Each entry: source + the board slug.
companies:
  - { source: greenhouse, slug: stripe, name: Stripe }
  - { source: lever, slug: netflix, name: Netflix }
  - { source: ashby, slug: ramp, name: Ramp }
```

`profile/.gitkeep`: empty file.

`profile/profile.template.json` (shape reference for a built profile — keys present, values empty):
```json
{
  "version": 1,
  "updatedAt": "1970-01-01T00:00:00.000Z",
  "basics": { "name": "", "headline": "", "yearsExperience": 0, "summary": "" },
  "skills": { "core": [], "familiar": [] },
  "experience": [],
  "preferences": {
    "targetRoles": [], "seniority": [], "locations": [], "remote": "any",
    "maxCommuteMiles": null, "minBaseComp": null, "mustHave": [], "dealbreakers": []
  },
  "notes": []
}
```

`README.md` (stub — fully written in Plan 3):
```markdown
# job-scout

Agentic CLI that finds relevant jobs and tailors applications from a living profile you build once and refine as you go. **Work in progress** — see `docs/superpowers/specs/`.
```

- [ ] **Step 5: Create `eslint.config.js` with the boundary rule (Spec §4)**

```js
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import boundaries from 'eslint-plugin-boundaries';
import prettier from 'eslint-config-prettier';

export default [
  {
    files: ['src/**/*.ts'],
    languageOptions: { parser: tsparser, parserOptions: { sourceType: 'module' } },
    plugins: { '@typescript-eslint': tseslint, boundaries },
    settings: {
      'boundaries/elements': [
        { type: 'core', pattern: 'src/(config|db|profile|sources|ingest|ui)/**' },
        { type: 'core', pattern: 'src/config.ts', mode: 'file' },
        { type: 'agent', pattern: 'src/agent/**' },
        { type: 'commands', pattern: 'src/commands/**' },
        { type: 'cli', pattern: 'src/cli.ts', mode: 'file' },
      ],
    },
    rules: {
      // The architectural invariant (Spec Principle 1): core must not import agent/LLM code.
      'boundaries/element-types': ['error', {
        default: 'allow',
        rules: [
          { from: 'core', disallow: ['agent'], message: 'Deterministic core must not import agent/LLM code (Spec Principle 1).' },
        ],
      }],
    },
  },
  {
    // SDK import ban applies ONLY to the deterministic core (Spec §4 module list).
    // scoring/score.ts, tailor/**, fetcher/**, commands/**, mcp/**, agent/** legitimately use LLMs.
    files: [
      'src/config.ts', 'src/db/**/*.ts', 'src/profile/schema.ts', 'src/profile/store.ts',
      'src/profile/pdf.ts', 'src/sources/**/*.ts', 'src/ingest/**/*.ts', 'src/ui/**/*.ts',
      'src/scoring/rubric.ts',
    ],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          { name: '@anthropic-ai/sdk', message: 'Deterministic core must not import the Anthropic SDK; go through src/agent (Spec Principle 1).' },
          { name: '@anthropic-ai/claude-agent-sdk', message: 'Deterministic core must not import the Agent SDK; go through src/agent (Spec Principle 1).' },
        ],
      }],
    },
  },
  prettier,
];
```

> The `no-restricted-imports` block is scoped to the exact core files from Spec §4 (note `scoring/rubric.ts` is core, but `scoring/score.ts` is **not** — it uses the SDK). No Anthropic deps exist yet in Plan 1, so this is a no-op that becomes load-bearing in Plan 2. No agent override is needed later because agent/scoring/tailor are outside the glob.

- [ ] **Step 6: Create `vitest.config.ts` and `src/cli.ts` skeleton**

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['test/**/*.test.ts'], environment: 'node' } });
```

`src/cli.ts`:
```ts
#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command();
program.name('job-scout').description('Find and tailor job applications from your living profile.').version('0.1.0');

// Subcommands are registered in later tasks.

program.parseAsync(process.argv).catch((err) => {
  console.error(process.env.JOB_SCOUT_DEBUG === '1' ? err : `Error: ${err.message}`);
  process.exit(1);
});
```

- [ ] **Step 7: Install and verify the toolchain**

Run:
```bash
npm install
npm run typecheck
npm run build
node dist/cli.js --help
```
Expected: install succeeds; typecheck/build clean; `--help` prints the program description and `--version`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: scaffold job-scout toolchain (tsc, eslint+boundaries, vitest)"
```

---

## Task 2: `config.ts`

**Files:**
- Create: `src/config.ts`, `test/config.test.ts`

- [ ] **Step 1: Write the failing test**

`test/config.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { loadConfig, SCORING_BATCH_SIZE } from '../src/config.js';

describe('loadConfig', () => {
  it('derives all paths from the root dir', () => {
    const c = loadConfig('/tmp/js', {});
    expect(c.profileJson).toBe(path.join('/tmp/js', 'profile', 'profile.json'));
    expect(c.dbPath).toBe(path.join('/tmp/js', 'job-scout.db'));
    expect(c.companiesFile).toBe(path.join('/tmp/js', 'companies.yaml'));
    expect(c.outputDir).toBe(path.join('/tmp/js', 'output'));
  });

  it('defaults models and honors env overrides', () => {
    expect(loadConfig('/x', {}).models.worker).toBe('claude-sonnet-4-6');
    expect(loadConfig('/x', {}).models.synth).toBe('claude-opus-4-8');
    const c = loadConfig('/x', { JOB_SCOUT_MODEL_WORKER: 'm1', JOB_SCOUT_MODEL_SYNTH: 'm2', JOB_SCOUT_DEBUG: '1' });
    expect(c.models.worker).toBe('m1');
    expect(c.models.synth).toBe('m2');
    expect(c.debug).toBe(true);
    expect(c.scoringBatchSize).toBe(SCORING_BATCH_SIZE);
  });
});
```

- [ ] **Step 2: Run it red**

Run: `npx vitest run test/config.test.ts`
Expected: FAIL — cannot find `../src/config.js`.

- [ ] **Step 3: Implement `src/config.ts`**

```ts
import path from 'node:path';

export const SCORING_BATCH_SIZE = 10;

export interface Config {
  rootDir: string;
  profileDir: string;
  profileJson: string;
  profileMd: string;
  outputDir: string;
  dbPath: string;
  companiesFile: string;
  anthropicApiKey: string | undefined;
  models: { worker: string; synth: string };
  scoringBatchSize: number;
  debug: boolean;
}

export function loadConfig(
  rootDir: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): Config {
  const profileDir = path.join(rootDir, 'profile');
  return {
    rootDir,
    profileDir,
    profileJson: path.join(profileDir, 'profile.json'),
    profileMd: path.join(profileDir, 'profile.md'),
    outputDir: path.join(rootDir, 'output'),
    dbPath: path.join(rootDir, 'job-scout.db'),
    companiesFile: path.join(rootDir, 'companies.yaml'),
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    models: {
      worker: env.JOB_SCOUT_MODEL_WORKER ?? 'claude-sonnet-4-6',
      synth: env.JOB_SCOUT_MODEL_SYNTH ?? 'claude-opus-4-8',
    },
    scoringBatchSize: SCORING_BATCH_SIZE,
    debug: env.JOB_SCOUT_DEBUG === '1',
  };
}
```

- [ ] **Step 4: Run it green**

Run: `npx vitest run test/config.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/config.ts test/config.test.ts
git commit -m "feat(config): paths, model tiering, and constants"
```

---

## Task 3: SQLite persistence (`db/`)

**Files:**
- Create: `src/db/schema.sql`, `src/db/migrate.ts`, `src/db/index.ts`, `test/db/index.test.ts`

- [ ] **Step 1: Create `src/db/schema.sql`** (verbatim from Spec §7)

```sql
CREATE TABLE IF NOT EXISTS jobs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source        TEXT NOT NULL,
  external_id   TEXT NOT NULL,
  company       TEXT NOT NULL,
  title         TEXT NOT NULL,
  url           TEXT NOT NULL,
  location      TEXT,
  remote        INTEGER,
  description   TEXT NOT NULL,
  score         INTEGER,
  matched_skills TEXT,
  missing_skills TEXT,
  score_reasons TEXT,
  status        TEXT NOT NULL DEFAULT 'new',
  posted_at     TEXT,
  first_seen    TEXT NOT NULL,
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

> `schema.sql` is read at runtime. Ensure it's copied to `dist/` on build: add `"build": "tsc && cp src/db/schema.sql dist/db/schema.sql"` to `package.json` scripts now, and load it via a path relative to the compiled file (see `migrate.ts`).

- [ ] **Step 2: Write the failing test**

`test/db/index.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, migrate, upsertJob, getJobs, getJobById, setStatus, insertApplication, getApplication } from '../../src/db/index.js';
import type { NormalizedJob } from '../../src/sources/types.js';

function sampleJob(over: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    source: 'greenhouse', externalId: 'g1', company: 'Acme', title: 'Senior Engineer',
    url: 'https://acme.example/jobs/g1', location: 'Remote', remote: true,
    description: 'Build things', postedAt: null, raw: { id: 'g1' }, ...over,
  };
}

describe('db', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => { db = openDb(':memory:'); migrate(db); });

  it('inserts a new job with status=new and score null', () => {
    const r = upsertJob(db, sampleJob());
    expect(r.inserted).toBe(true);
    const row = getJobById(db, r.id)!;
    expect(row.status).toBe('new');
    expect(row.score).toBeNull();
    expect(row.company).toBe('Acme');
  });

  it('upsert updates mutable fields but never resets a non-new status', () => {
    const r = upsertJob(db, sampleJob());
    setStatus(db, r.id, 'applied');
    const r2 = upsertJob(db, sampleJob({ title: 'Staff Engineer' }));
    expect(r2.inserted).toBe(false);
    const row = getJobById(db, r.id)!;
    expect(row.title).toBe('Staff Engineer'); // mutable field updated
    expect(row.status).toBe('applied');       // human status preserved
  });

  it('persists scoring fields when provided', () => {
    const r = upsertJob(db, sampleJob(), { score: 87, matchedSkills: ['TS'], missingSkills: ['Go'], reasons: 'strong' });
    const row = getJobById(db, r.id)!;
    expect(row.score).toBe(87);
    expect(JSON.parse(row.matched_skills!)).toEqual(['TS']);
  });

  it('filters by status and minScore', () => {
    const a = upsertJob(db, sampleJob({ externalId: 'a' }), { score: 90, matchedSkills: [], missingSkills: [], reasons: '' });
    upsertJob(db, sampleJob({ externalId: 'b' }), { score: 40, matchedSkills: [], missingSkills: [], reasons: '' });
    setStatus(db, a.id, 'interested');
    expect(getJobs(db, { status: 'interested' }).map((j) => j.external_id)).toEqual(['a']);
    expect(getJobs(db, { minScore: 80 }).map((j) => j.external_id)).toEqual(['a']);
  });

  it('upserts applications by job_id', () => {
    const r = upsertJob(db, sampleJob());
    insertApplication(db, { jobId: r.id, resumePath: 'a.md', coverPath: 'b.md', fitNotesPath: 'c.md' });
    insertApplication(db, { jobId: r.id, resumePath: 'a2.md', coverPath: 'b2.md', fitNotesPath: 'c2.md' });
    expect(getApplication(db, r.id)!.resume_path).toBe('a2.md');
  });
});
```

- [ ] **Step 3: Run it red**

Run: `npx vitest run test/db/index.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement `src/db/migrate.ts` and `src/db/index.ts`**

`src/db/migrate.ts`:
```ts
import type Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function migrate(db: Database.Database): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const sql = readFileSync(path.join(here, 'schema.sql'), 'utf8');
  db.exec(sql);
}
```

`src/db/index.ts`:
```ts
import Database from 'better-sqlite3';
import type { NormalizedJob } from '../sources/types.js';
export { migrate } from './migrate.js';

export type JobStatus = 'new' | 'interested' | 'applied' | 'rejected';

export interface JobScoreFields {
  score: number;
  matchedSkills: string[];
  missingSkills: string[];
  reasons: string;
}

export interface JobRow {
  id: number; source: string; external_id: string; company: string; title: string;
  url: string; location: string | null; remote: number | null; description: string;
  score: number | null; matched_skills: string | null; missing_skills: string | null;
  score_reasons: string | null; status: JobStatus; posted_at: string | null;
  first_seen: string; raw_json: string;
}

export interface ApplicationRow {
  id: number; job_id: number; resume_path: string; cover_path: string;
  fit_notes_path: string; created_at: string;
}

export function openDb(file: string): Database.Database {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  return db;
}

export function upsertJob(
  db: Database.Database,
  job: NormalizedJob,
  score?: JobScoreFields,
): { id: number; inserted: boolean } {
  const existing = db
    .prepare('SELECT id FROM jobs WHERE source = ? AND external_id = ?')
    .get(job.source, job.externalId) as { id: number } | undefined;

  const common = {
    company: job.company, title: job.title, url: job.url, location: job.location,
    remote: job.remote === null ? null : job.remote ? 1 : 0, description: job.description,
    posted_at: job.postedAt, raw_json: JSON.stringify(job.raw),
    score: score?.score ?? null,
    matched_skills: score ? JSON.stringify(score.matchedSkills) : null,
    missing_skills: score ? JSON.stringify(score.missingSkills) : null,
    score_reasons: score?.reasons ?? null,
  };

  if (existing) {
    db.prepare(
      `UPDATE jobs SET company=@company, title=@title, url=@url, location=@location,
        remote=@remote, description=@description, posted_at=@posted_at, raw_json=@raw_json,
        score=COALESCE(@score, score), matched_skills=COALESCE(@matched_skills, matched_skills),
        missing_skills=COALESCE(@missing_skills, missing_skills),
        score_reasons=COALESCE(@score_reasons, score_reasons)
       WHERE id=@id`,
    ).run({ ...common, id: existing.id });
    return { id: existing.id, inserted: false };
  }

  const info = db.prepare(
    `INSERT INTO jobs (source, external_id, company, title, url, location, remote, description,
        score, matched_skills, missing_skills, score_reasons, status, posted_at, first_seen, raw_json)
     VALUES (@source, @external_id, @company, @title, @url, @location, @remote, @description,
        @score, @matched_skills, @missing_skills, @score_reasons, 'new', @posted_at, @first_seen, @raw_json)`,
  ).run({ ...common, source: job.source, external_id: job.externalId, first_seen: new Date().toISOString() });
  return { id: Number(info.lastInsertRowid), inserted: true };
}

export function getJobs(
  db: Database.Database,
  filter: { status?: JobStatus; minScore?: number; limit?: number } = {},
): JobRow[] {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};
  if (filter.status) { clauses.push('status = @status'); params.status = filter.status; }
  if (filter.minScore != null) { clauses.push('score >= @minScore'); params.minScore = filter.minScore; }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = filter.limit ? 'LIMIT @limit' : '';
  if (filter.limit) params.limit = filter.limit;
  return db
    .prepare(`SELECT * FROM jobs ${where} ORDER BY score DESC NULLS LAST, first_seen DESC ${limit}`)
    .all(params) as JobRow[];
}

export function getJobById(db: Database.Database, id: number): JobRow | undefined {
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
}

export function existingKeys(db: Database.Database): { ids: Set<string>; urls: Set<string> } {
  const rows = db.prepare('SELECT source, external_id, url FROM jobs').all() as {
    source: string; external_id: string; url: string;
  }[];
  return {
    ids: new Set(rows.map((r) => `${r.source}:${r.external_id}`)),
    urls: new Set(rows.map((r) => r.url)),
  };
}

export function setStatus(db: Database.Database, id: number, status: JobStatus): boolean {
  return db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run(status, id).changes > 0;
}

export function insertApplication(
  db: Database.Database,
  a: { jobId: number; resumePath: string; coverPath: string; fitNotesPath: string },
): void {
  db.prepare(
    `INSERT INTO applications (job_id, resume_path, cover_path, fit_notes_path, created_at)
     VALUES (@jobId, @resumePath, @coverPath, @fitNotesPath, @createdAt)
     ON CONFLICT(job_id) DO UPDATE SET resume_path=excluded.resume_path,
       cover_path=excluded.cover_path, fit_notes_path=excluded.fit_notes_path,
       created_at=excluded.created_at`,
  ).run({ ...a, createdAt: new Date().toISOString() });
}

export function getApplication(db: Database.Database, jobId: number): ApplicationRow | undefined {
  return db.prepare('SELECT * FROM applications WHERE job_id = ?').get(jobId) as ApplicationRow | undefined;
}
```

> `NormalizedJob` is defined in Task 4's `src/sources/types.ts`. If you implement strictly in order, create that file first (it's tiny) or temporarily inline the type. The plan defines it in Task 5; pull it forward if your runner type-checks per task.

- [ ] **Step 5: Run it green**

Run: `npx vitest run test/db/index.test.ts`
Expected: PASS (all 5).

- [ ] **Step 6: Commit**

```bash
git add src/db test/db package.json
git commit -m "feat(db): sqlite schema, status-preserving upsert, typed queries"
```

---

## Task 4: Profile schema + store (`profile/schema.ts`, `profile/store.ts`)

**Files:**
- Create: `src/profile/schema.ts`, `src/profile/store.ts`, `test/profile/store.test.ts`

- [ ] **Step 1: Implement `src/profile/schema.ts`** (verbatim from Spec §5.2)

```ts
import { z } from 'zod';

export const ProfileSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string(),
  basics: z.object({
    name: z.string(),
    headline: z.string(),
    yearsExperience: z.number(),
    summary: z.string(),
  }),
  skills: z.object({ core: z.array(z.string()), familiar: z.array(z.string()) }),
  experience: z.array(
    z.object({
      company: z.string(),
      title: z.string(),
      start: z.string(),
      end: z.string().nullable(),
      highlights: z.array(z.string()),
      tech: z.array(z.string()),
    }),
  ),
  preferences: z.object({
    targetRoles: z.array(z.string()),
    seniority: z.array(z.string()),
    locations: z.array(z.string()),
    remote: z.enum(['remote', 'hybrid', 'onsite', 'any']),
    maxCommuteMiles: z.number().nullable(),
    minBaseComp: z.number().nullable(),
    mustHave: z.array(z.string()),
    dealbreakers: z.array(z.string()),
  }),
  notes: z.array(z.string()),
  extras: z.record(z.unknown()).optional(),
});

export type Profile = z.infer<typeof ProfileSchema>;
```

- [ ] **Step 2: Write the failing test**

`test/profile/store.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../src/config.js';
import { loadProfile, saveProfile, renderProfileMarkdown } from '../../src/profile/store.js';
import type { Profile } from '../../src/profile/schema.js';

const sample: Profile = {
  version: 1, updatedAt: '2026-06-01T00:00:00.000Z',
  basics: { name: 'Chris', headline: 'FS Eng', yearsExperience: 8, summary: 'Builds things.' },
  skills: { core: ['TypeScript', 'DynamoDB'], familiar: ['Python'] },
  experience: [{ company: 'Acme', title: 'Senior Eng', start: '2020-01', end: null, highlights: ['Led X'], tech: ['TS'] }],
  preferences: { targetRoles: ['Senior FS'], seniority: ['senior'], locations: ['Remote'], remote: 'remote', maxCommuteMiles: null, minBaseComp: null, mustHave: ['TypeScript'], dealbreakers: ['PHP'] },
  notes: [],
};

describe('profile store', () => {
  it('returns null when no profile exists', () => {
    const cfg = loadConfig(mkdtempSync(path.join(tmpdir(), 'js-')), {});
    expect(loadProfile(cfg)).toBeNull();
  });

  it('round-trips a profile through json', () => {
    const cfg = loadConfig(mkdtempSync(path.join(tmpdir(), 'js-')), {});
    saveProfile(cfg, sample);
    expect(loadProfile(cfg)).toEqual(sample);
  });

  it('writes a human-readable profile.md', () => {
    const cfg = loadConfig(mkdtempSync(path.join(tmpdir(), 'js-')), {});
    saveProfile(cfg, sample);
    const md = readFileSync(cfg.profileMd, 'utf8');
    expect(md).toContain('# Chris');
    expect(md).toContain('DynamoDB');
    expect(md).toContain('Acme');
  });

  it('renderProfileMarkdown is pure and includes preferences', () => {
    expect(renderProfileMarkdown(sample)).toContain('Remote');
    expect(renderProfileMarkdown(sample)).toContain('TypeScript');
  });

  it('throws on an invalid stored profile', () => {
    const cfg = loadConfig(mkdtempSync(path.join(tmpdir(), 'js-')), {});
    saveProfile(cfg, sample);
    // corrupt it
    const fs = require('node:fs');
    fs.writeFileSync(cfg.profileJson, '{"version":1}');
    expect(() => loadProfile(cfg)).toThrow();
  });
});
```

- [ ] **Step 3: Run it red**

Run: `npx vitest run test/profile/store.test.ts`
Expected: FAIL — `store.js` not found.

- [ ] **Step 4: Implement `src/profile/store.ts`**

```ts
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { Config } from '../config.js';
import { ProfileSchema, type Profile } from './schema.js';

export function loadProfile(cfg: Config): Profile | null {
  if (!existsSync(cfg.profileJson)) return null;
  const parsed = JSON.parse(readFileSync(cfg.profileJson, 'utf8'));
  return ProfileSchema.parse(parsed); // throws on invalid
}

export function saveProfile(cfg: Config, profile: Profile): void {
  mkdirSync(path.dirname(cfg.profileJson), { recursive: true });
  ProfileSchema.parse(profile);
  writeFileSync(cfg.profileJson, JSON.stringify(profile, null, 2) + '\n');
  writeFileSync(cfg.profileMd, renderProfileMarkdown(profile));
}

export function renderProfileMarkdown(p: Profile): string {
  const lines: string[] = [];
  lines.push(`# ${p.basics.name}`, '', `**${p.basics.headline}** — ${p.basics.yearsExperience} years`, '', p.basics.summary, '');
  lines.push('## Skills', '', `**Core:** ${p.skills.core.join(', ')}`, `**Familiar:** ${p.skills.familiar.join(', ')}`, '');
  lines.push('## Experience', '');
  for (const e of p.experience) {
    lines.push(`### ${e.title} — ${e.company} (${e.start}–${e.end ?? 'present'})`);
    for (const h of e.highlights) lines.push(`- ${h}`);
    if (e.tech.length) lines.push(`*Tech: ${e.tech.join(', ')}*`);
    lines.push('');
  }
  const pr = p.preferences;
  lines.push('## Preferences', '',
    `- Target roles: ${pr.targetRoles.join(', ')}`,
    `- Seniority: ${pr.seniority.join(', ')}`,
    `- Locations: ${pr.locations.join(', ')} (remote: ${pr.remote})`,
    `- Max commute: ${pr.maxCommuteMiles ?? 'n/a'} mi`,
    `- Min base comp: ${pr.minBaseComp ?? 'n/a'}`,
    `- Must have: ${pr.mustHave.join(', ')}`,
    `- Dealbreakers: ${pr.dealbreakers.join(', ')}`, '');
  if (p.notes.length) lines.push('## Notes', '', ...p.notes.map((n) => `- ${n}`), '');
  return lines.join('\n');
}
```

- [ ] **Step 5: Run it green**

Run: `npx vitest run test/profile/store.test.ts`
Expected: PASS (all 5).

- [ ] **Step 6: Commit**

```bash
git add src/profile/schema.ts src/profile/store.ts test/profile/store.test.ts
git commit -m "feat(profile): zod schema, json store, markdown render"
```

---

## Task 5: PDF extraction + source types (`profile/pdf.ts`, `sources/types.ts`)

**Files:**
- Create: `src/sources/types.ts`, `src/profile/pdf.ts`, `test/profile/pdf.test.ts`, `test/fixtures/sample.pdf`

- [ ] **Step 1: Implement `src/sources/types.ts`** (needed by db + sources)

```ts
export type SourceName = 'greenhouse' | 'lever' | 'ashby' | 'url';

export interface NormalizedJob {
  source: SourceName;
  externalId: string;
  company: string;
  title: string;
  url: string;
  location: string | null;
  remote: boolean | null;
  description: string;
  postedAt: string | null;
  raw: unknown;
}

export interface WatchlistEntry {
  source: Exclude<SourceName, 'url'>;
  slug: string;
  name?: string;
}

export interface SourceAdapter {
  source: Exclude<SourceName, 'url'>;
  fetchJobs(entry: WatchlistEntry): Promise<NormalizedJob[]>;
}
```

- [ ] **Step 2: Create the test fixture PDF**

A tiny valid PDF whose text content is `Hello Resume Chris`. Create `test/fixtures/sample.pdf` with exactly these bytes (a minimal one-page PDF):

```bash
cat > test/fixtures/sample.pdf <<'PDF'
%PDF-1.1
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 58>>stream
BT /F1 18 Tf 20 100 Td (Hello Resume Chris) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R>>
PDF
```

> If `unpdf` fails to parse this minimal PDF on your platform, replace it with any small real PDF placed at `test/fixtures/sample.pdf` and update the expected substring in the test accordingly. The point is one committed, non-personal fixture.

- [ ] **Step 3: Write the failing test**

`test/profile/pdf.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { cleanText, extractPdfText } from '../../src/profile/pdf.js';

describe('pdf', () => {
  it('cleanText collapses whitespace and strips control chars', () => {
    expect(cleanText('a   b\n\n\nc   d')).toBe('a b\n\nc d');
  });

  it('extracts text from a pdf', async () => {
    const txt = await extractPdfText(path.join(__dirname, '../fixtures/sample.pdf'));
    expect(txt.toLowerCase()).toContain('resume');
  });
});
```

- [ ] **Step 4: Run it red**

Run: `npx vitest run test/profile/pdf.test.ts`
Expected: FAIL — `pdf.js` not found.

- [ ] **Step 5: Implement `src/profile/pdf.ts`**

```ts
import { readFile } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { extractText, getDocumentProxy } from 'unpdf';

export function cleanText(raw: string): string {
  return raw
    .replace(/[ --]/g, '') // control chars (keep \n, \t)
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function extractPdfText(file: string): Promise<string> {
  const buf = new Uint8Array(await readFile(file));
  const pdf = await getDocumentProxy(buf);
  const { text } = await extractText(pdf, { mergePages: true });
  return cleanText(Array.isArray(text) ? text.join('\n') : text);
}

export async function extractProfileSources(dir: string): Promise<{ file: string; text: string }[]> {
  const pdfs = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf'));
  const out: { file: string; text: string }[] = [];
  for (const f of pdfs) out.push({ file: f, text: await extractPdfText(path.join(dir, f)) });
  return out;
}
```

> Verify the `unpdf` import surface against the installed version (`extractText` + `getDocumentProxy` are the documented entry points). If the API differs, adapt the two boundary calls only; `cleanText` and the signatures must not change.

- [ ] **Step 6: Run it green, then commit**

Run: `npx vitest run test/profile/pdf.test.ts`
Expected: PASS.
```bash
git add src/sources/types.ts src/profile/pdf.ts test/profile/pdf.test.ts test/fixtures/sample.pdf
git commit -m "feat(profile): pdf text extraction + source types"
```

---

## Task 6: HTTP helper + ATS adapters (`sources/`)

**Files:**
- Create: `src/sources/http.ts`, `src/sources/greenhouse.ts`, `src/sources/lever.ts`, `src/sources/ashby.ts`, `src/sources/index.ts`
- Create: `test/sources/http.test.ts`, `test/sources/greenhouse.test.ts`, `test/sources/lever.test.ts`
- Create fixtures: `test/fixtures/greenhouse.json`, `test/fixtures/lever.json`

- [ ] **Step 1: Write the failing test for `http.ts` (`stripHtml` + retry)**

`test/sources/http.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { stripHtml, fetchJson } from '../../src/sources/http.js';

describe('stripHtml', () => {
  it('converts html to readable text', () => {
    const out = stripHtml('<p>Hello&nbsp;<b>world</b></p><ul><li>a</li><li>b</li></ul>');
    expect(out).toContain('Hello world');
    expect(out).toContain('a');
    expect(out).not.toContain('<');
  });
});

describe('fetchJson', () => {
  it('retries on failure then succeeds', async () => {
    const f = vi.fn()
      .mockRejectedValueOnce(new Error('net'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: 1 }) } as Response);
    const r = await fetchJson('https://x', { retries: 2, backoffMs: 1, fetchImpl: f as unknown as typeof fetch });
    expect(r).toEqual({ ok: 1 });
    expect(f).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run it red, then implement `src/sources/http.ts`**

```ts
import { convert } from 'html-to-text';

export function stripHtml(html: string): string {
  return convert(html, { wordwrap: false, selectors: [{ selector: 'a', options: { ignoreHref: true } }] }).trim();
}

export async function fetchJson<T = unknown>(
  url: string,
  opts: { retries?: number; backoffMs?: number; init?: RequestInit; fetchImpl?: typeof fetch } = {},
): Promise<T> {
  const { retries = 3, backoffMs = 300, init, fetchImpl = fetch } = opts;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetchImpl(url, init);
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, backoffMs * 2 ** (attempt - 1)));
    }
  }
  throw lastErr;
}
```

Run: `npx vitest run test/sources/http.test.ts` → PASS.

- [ ] **Step 3: Create recorded fixtures**

`test/fixtures/greenhouse.json` (shape of `boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true`):
```json
{
  "jobs": [
    {
      "id": 12345,
      "title": "Senior Software Engineer",
      "absolute_url": "https://boards.greenhouse.io/acme/jobs/12345",
      "location": { "name": "Remote - US" },
      "content": "&lt;p&gt;Build &lt;b&gt;TypeScript&lt;/b&gt; services.&lt;/p&gt;",
      "updated_at": "2026-05-20T12:00:00-04:00"
    }
  ]
}
```

`test/fixtures/lever.json` (shape of `api.lever.co/v0/postings/{slug}?mode=json`):
```json
[
  {
    "id": "abc-123",
    "text": "Staff Frontend Engineer",
    "categories": { "location": "Remote", "commitment": "Full-time" },
    "hostedUrl": "https://jobs.lever.co/acme/abc-123",
    "descriptionPlain": "Own the React platform.",
    "createdAt": 1716220800000
  }
]
```

> These mirror the real public response shapes. After implementing, run the live endpoints once for a real company and overwrite these fixtures with recorded output to keep them authentic (Spec §6.1).

- [ ] **Step 4: Write failing tests for greenhouse + lever adapters**

`test/sources/greenhouse.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { greenhouse } from '../../src/sources/greenhouse.js';

describe('greenhouse adapter', () => {
  it('normalizes the board response', async () => {
    const fixture = JSON.parse(readFileSync(path.join(__dirname, '../fixtures/greenhouse.json'), 'utf8'));
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => fixture } as Response);
    const jobs = await greenhouse.fetchJobs({ source: 'greenhouse', slug: 'acme', name: 'Acme' }, fetchImpl as unknown as typeof fetch);
    expect(jobs).toHaveLength(1);
    const j = jobs[0];
    expect(j.source).toBe('greenhouse');
    expect(j.externalId).toBe('12345');
    expect(j.company).toBe('Acme');
    expect(j.title).toBe('Senior Software Engineer');
    expect(j.location).toBe('Remote - US');
    expect(j.remote).toBe(true);
    expect(j.description).toContain('TypeScript'); // html entities decoded + stripped
    expect(j.description).not.toContain('<');
  });
});
```

`test/sources/lever.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { lever } from '../../src/sources/lever.js';

describe('lever adapter', () => {
  it('normalizes the postings response', async () => {
    const fixture = JSON.parse(readFileSync(path.join(__dirname, '../fixtures/lever.json'), 'utf8'));
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => fixture } as Response);
    const jobs = await lever.fetchJobs({ source: 'lever', slug: 'acme', name: 'Acme' }, fetchImpl as unknown as typeof fetch);
    expect(jobs[0].externalId).toBe('abc-123');
    expect(jobs[0].title).toBe('Staff Frontend Engineer');
    expect(jobs[0].remote).toBe(true);
    expect(jobs[0].url).toBe('https://jobs.lever.co/acme/abc-123');
  });
});
```

- [ ] **Step 5: Run them red, then implement the adapters**

`src/sources/greenhouse.ts`:
```ts
import { decode } from 'html-to-text'; // not used; see note
import { fetchJson, stripHtml } from './http.js';
import type { NormalizedJob, SourceAdapter, WatchlistEntry } from './types.js';

interface GhJob {
  id: number; title: string; absolute_url: string;
  location?: { name?: string }; content?: string; updated_at?: string;
}

function isRemote(loc: string | null): boolean | null {
  if (!loc) return null;
  return /remote/i.test(loc) ? true : null;
}

// Greenhouse `content` is HTML-entity-encoded HTML; decode entities then strip tags.
function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}

export const greenhouse: SourceAdapter & {
  fetchJobs(entry: WatchlistEntry, fetchImpl?: typeof fetch): Promise<NormalizedJob[]>;
} = {
  source: 'greenhouse',
  async fetchJobs(entry, fetchImpl = fetch) {
    const url = `https://boards-api.greenhouse.io/v1/boards/${entry.slug}/jobs?content=true`;
    const data = await fetchJson<{ jobs: GhJob[] }>(url, { init: { headers: { accept: 'application/json' } }, fetchImpl });
    return (data.jobs ?? []).map((j) => {
      const location = j.location?.name ?? null;
      return {
        source: 'greenhouse', externalId: String(j.id), company: entry.name ?? entry.slug,
        title: j.title, url: j.absolute_url, location, remote: isRemote(location),
        description: stripHtml(decodeEntities(j.content ?? '')), postedAt: j.updated_at ?? null, raw: j,
      };
    });
  },
};
```
> Remove the unused `decode` import; it's a reminder that html-to-text doesn't decode pre-encoded entities — we do it explicitly in `decodeEntities`.

`src/sources/lever.ts`:
```ts
import { fetchJson, stripHtml } from './http.js';
import type { NormalizedJob, SourceAdapter, WatchlistEntry } from './types.js';

interface LeverPosting {
  id: string; text: string; hostedUrl: string;
  categories?: { location?: string; commitment?: string };
  descriptionPlain?: string; description?: string; createdAt?: number;
}

export const lever: SourceAdapter & {
  fetchJobs(entry: WatchlistEntry, fetchImpl?: typeof fetch): Promise<NormalizedJob[]>;
} = {
  source: 'lever',
  async fetchJobs(entry, fetchImpl = fetch) {
    const url = `https://api.lever.co/v0/postings/${entry.slug}?mode=json`;
    const data = await fetchJson<LeverPosting[]>(url, { fetchImpl });
    return (data ?? []).map((p) => {
      const location = p.categories?.location ?? null;
      return {
        source: 'lever', externalId: p.id, company: entry.name ?? entry.slug,
        title: p.text, url: p.hostedUrl, location,
        remote: location ? /remote/i.test(location) : null,
        description: p.descriptionPlain ?? stripHtml(p.description ?? ''),
        postedAt: p.createdAt ? new Date(p.createdAt).toISOString() : null, raw: p,
      };
    });
  },
};
```

`src/sources/ashby.ts` (best-effort per Ashby's public posting API; record a real fixture to confirm):
```ts
import { fetchJson, stripHtml } from './http.js';
import type { NormalizedJob, SourceAdapter, WatchlistEntry } from './types.js';

interface AshbyJob {
  id: string; title: string; location?: string; isRemote?: boolean;
  jobUrl?: string; applyUrl?: string; descriptionHtml?: string;
  descriptionPlain?: string; publishedAt?: string;
}

export const ashby: SourceAdapter & {
  fetchJobs(entry: WatchlistEntry, fetchImpl?: typeof fetch): Promise<NormalizedJob[]>;
} = {
  source: 'ashby',
  async fetchJobs(entry, fetchImpl = fetch) {
    const url = `https://api.ashbyhq.com/posting-api/job-board/${entry.slug}`;
    const data = await fetchJson<{ jobs: AshbyJob[] }>(url, {
      init: { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) },
      fetchImpl,
    });
    return (data.jobs ?? []).map((j) => ({
      source: 'ashby', externalId: j.id, company: entry.name ?? entry.slug, title: j.title,
      url: j.jobUrl ?? j.applyUrl ?? '', location: j.location ?? null,
      remote: j.isRemote ?? (j.location ? /remote/i.test(j.location) : null),
      description: j.descriptionPlain ?? stripHtml(j.descriptionHtml ?? ''),
      postedAt: j.publishedAt ?? null, raw: j,
    }));
  },
};
```

Run: `npx vitest run test/sources` → PASS (greenhouse + lever; ashby is covered once you record a fixture — add an analogous test then).

- [ ] **Step 6: Implement `src/sources/index.ts` (registry + watchlist loader) and commit**

```ts
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import { greenhouse } from './greenhouse.js';
import { lever } from './lever.js';
import { ashby } from './ashby.js';
import type { SourceAdapter, WatchlistEntry } from './types.js';

export const adapters: Record<WatchlistEntry['source'], SourceAdapter> = { greenhouse, lever, ashby };

export function loadWatchlist(file: string): WatchlistEntry[] {
  const doc = parse(readFileSync(file, 'utf8')) as { companies?: WatchlistEntry[] };
  return doc.companies ?? [];
}
```

```bash
git add src/sources test/sources test/fixtures/greenhouse.json test/fixtures/lever.json
git commit -m "feat(sources): http helper + greenhouse/lever/ashby adapters + watchlist loader"
```

---

## Task 7: Ingest pipeline (`ingest/dedup.ts`, `ingest/prefilter.ts`, `ingest/pipeline.ts`)

**Files:**
- Create: `src/ingest/dedup.ts`, `src/ingest/prefilter.ts`, `src/ingest/pipeline.ts`
- Create: `test/ingest/dedup.test.ts`, `test/ingest/prefilter.test.ts`, `test/ingest/pipeline.test.ts`

- [ ] **Step 1: Write the failing test for `dedup`**

`test/ingest/dedup.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, migrate, upsertJob } from '../../src/db/index.js';
import { dedup } from '../../src/ingest/dedup.js';
import type { NormalizedJob } from '../../src/sources/types.js';

const j = (over: Partial<NormalizedJob>): NormalizedJob => ({
  source: 'greenhouse', externalId: 'x', company: 'A', title: 'T', url: 'u', location: null,
  remote: null, description: '', postedAt: null, raw: {}, ...over,
});

describe('dedup', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => { db = openDb(':memory:'); migrate(db); });

  it('drops jobs already in db by (source, externalId) or url', () => {
    upsertJob(db, j({ externalId: 'a', url: 'http://a' }));
    const { fresh, duplicates } = dedup(db, [
      j({ externalId: 'a', url: 'http://a' }),     // dup by key
      j({ externalId: 'b', url: 'http://a' }),     // dup by url
      j({ externalId: 'c', url: 'http://c' }),     // fresh
    ]);
    expect(fresh.map((f) => f.externalId)).toEqual(['c']);
    expect(duplicates).toHaveLength(2);
  });

  it('dedups within the same batch', () => {
    const { fresh } = dedup(db, [j({ externalId: 'a', url: 'http://a' }), j({ externalId: 'a', url: 'http://a' })]);
    expect(fresh).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run red, implement `src/ingest/dedup.ts`**

```ts
import type Database from 'better-sqlite3';
import { existingKeys } from '../db/index.js';
import type { NormalizedJob } from '../sources/types.js';

export function dedup(
  db: Database.Database,
  jobs: NormalizedJob[],
): { fresh: NormalizedJob[]; duplicates: NormalizedJob[] } {
  const { ids, urls } = existingKeys(db);
  const seenKey = new Set<string>();
  const seenUrl = new Set<string>();
  const fresh: NormalizedJob[] = [];
  const duplicates: NormalizedJob[] = [];
  for (const job of jobs) {
    const key = `${job.source}:${job.externalId}`;
    if (ids.has(key) || urls.has(job.url) || seenKey.has(key) || seenUrl.has(job.url)) {
      duplicates.push(job);
    } else {
      fresh.push(job);
      seenKey.add(key);
      seenUrl.add(job.url);
    }
  }
  return { fresh, duplicates };
}
```
Run: `npx vitest run test/ingest/dedup.test.ts` → PASS.

- [ ] **Step 3: Write the failing test for `prefilter` (Spec §6.3)**

`test/ingest/prefilter.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { prefilter } from '../../src/ingest/prefilter.js';
import type { Profile } from '../../src/profile/schema.js';
import type { NormalizedJob } from '../../src/sources/types.js';

const profile = (over: Partial<Profile['preferences']> = {}): Profile => ({
  version: 1, updatedAt: '', basics: { name: '', headline: '', yearsExperience: 8, summary: '' },
  skills: { core: [], familiar: [] }, experience: [], notes: [],
  preferences: {
    targetRoles: [], seniority: ['senior', 'staff'], locations: [], remote: 'any',
    maxCommuteMiles: null, minBaseComp: null, mustHave: ['TypeScript'], dealbreakers: ['PHP'], ...over,
  },
});

const j = (over: Partial<NormalizedJob>): NormalizedJob => ({
  source: 'greenhouse', externalId: 'x', company: 'A', title: 'Senior Engineer', url: 'u',
  location: 'Remote', remote: true, description: 'We use TypeScript and Node', postedAt: null, raw: {}, ...over,
});

describe('prefilter', () => {
  it('drops on dealbreaker term', () => {
    const { dropped } = prefilter([j({ description: 'Legacy PHP shop' })], profile());
    expect(dropped[0].reason).toMatch(/dealbreaker/i);
  });

  it('drops when no mustHave term is present anywhere', () => {
    const { dropped } = prefilter([j({ title: 'Engineer', description: 'We use Go' })], profile());
    expect(dropped[0].reason).toMatch(/must-have/i);
  });

  it('drops on clear seniority mismatch', () => {
    const { dropped } = prefilter([j({ title: 'Junior Engineer Intern' })], profile());
    expect(dropped[0].reason).toMatch(/seniority/i);
  });

  it('drops onsite job when preference is remote', () => {
    const { dropped } = prefilter([j({ remote: false, location: 'New York, NY' })], profile({ remote: 'remote' }));
    expect(dropped[0].reason).toMatch(/remote/i);
  });

  it('keeps a clearly matching job', () => {
    const { kept, dropped } = prefilter([j({})], profile());
    expect(kept).toHaveLength(1);
    expect(dropped).toHaveLength(0);
  });

  it('keeps when unsure (no mustHave configured)', () => {
    const { kept } = prefilter([j({ description: 'We use Go' })], profile({ mustHave: [] }));
    expect(kept).toHaveLength(1);
  });
});
```

- [ ] **Step 4: Run red, implement `src/ingest/prefilter.ts`**

```ts
import type { Profile } from '../profile/schema.js';
import type { NormalizedJob } from '../sources/types.js';

export interface Dropped { job: NormalizedJob; reason: string }

const JUNIOR = /\b(intern|internship|junior|jr\.?|entry[- ]level|new grad|graduate)\b/i;

function hay(job: NormalizedJob): string {
  return `${job.title}\n${job.description}\n${job.location ?? ''}`.toLowerCase();
}

export function prefilter(
  jobs: NormalizedJob[],
  profile: Profile,
): { kept: NormalizedJob[]; dropped: Dropped[] } {
  const pref = profile.preferences;
  const kept: NormalizedJob[] = [];
  const dropped: Dropped[] = [];

  for (const job of jobs) {
    const text = hay(job);

    const db = pref.dealbreakers.find((d) => d && text.includes(d.toLowerCase()));
    if (db) { dropped.push({ job, reason: `dealbreaker: "${db}"` }); continue; }

    if (pref.mustHave.length && !pref.mustHave.some((m) => text.includes(m.toLowerCase()))) {
      dropped.push({ job, reason: `missing all must-have terms: ${pref.mustHave.join(', ')}` });
      continue;
    }

    const wantsSenior = pref.seniority.some((s) => /senior|staff|principal|lead/i.test(s));
    if (wantsSenior && JUNIOR.test(job.title)) {
      dropped.push({ job, reason: `seniority mismatch: "${job.title}"` });
      continue;
    }

    if (pref.remote === 'remote' && job.remote === false) {
      dropped.push({ job, reason: 'remote preference but job is onsite' });
      continue;
    }

    kept.push(job);
  }
  return { kept, dropped };
}
```
Run: `npx vitest run test/ingest/prefilter.test.ts` → PASS (all 6).

- [ ] **Step 5: Write the failing test for `pipeline.ingest` (injected scorer)**

`test/ingest/pipeline.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, migrate, getJobs } from '../../src/db/index.js';
import { ingest } from '../../src/ingest/pipeline.js';
import type { Profile } from '../../src/profile/schema.js';
import type { NormalizedJob } from '../../src/sources/types.js';

const profile: Profile = {
  version: 1, updatedAt: '', basics: { name: '', headline: '', yearsExperience: 8, summary: '' },
  skills: { core: [], familiar: [] }, experience: [], notes: [],
  preferences: { targetRoles: [], seniority: [], locations: [], remote: 'any', maxCommuteMiles: null, minBaseComp: null, mustHave: [], dealbreakers: ['PHP'] },
};
const j = (id: string, over: Partial<NormalizedJob> = {}): NormalizedJob => ({
  source: 'greenhouse', externalId: id, company: 'A', title: 'Senior Engineer', url: `http://${id}`,
  location: 'Remote', remote: true, description: 'TypeScript', postedAt: null, raw: {}, ...over,
});

describe('ingest', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => { db = openDb(':memory:'); migrate(db); });

  it('dedups, prefilters, persists with status=new and no scorer leaves score null', async () => {
    const summary = await ingest(db, [j('a'), j('b', { description: 'PHP only' })], profile, { score: null });
    expect(summary.added).toBe(1);
    expect(summary.dropped).toBe(1);
    const rows = getJobs(db, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].score).toBeNull();
    expect(rows[0].status).toBe('new');
  });

  it('applies an injected scorer', async () => {
    const scorer = async (jobs: NormalizedJob[]) =>
      new Map(jobs.map((x) => [`${x.source}:${x.externalId}`, { score: 75, matchedSkills: ['TS'], missingSkills: [], reasons: 'ok' }]));
    const summary = await ingest(db, [j('a')], profile, { score: scorer });
    expect(summary.added).toBe(1);
    expect(getJobs(db, {})[0].score).toBe(75);
  });
});
```

- [ ] **Step 6: Run red, implement `src/ingest/pipeline.ts`**

```ts
import type Database from 'better-sqlite3';
import { upsertJob, type JobScoreFields } from '../db/index.js';
import type { Profile } from '../profile/schema.js';
import type { NormalizedJob } from '../sources/types.js';
import { dedup } from './dedup.js';
import { prefilter, type Dropped } from './prefilter.js';

export type Scorer = (
  jobs: NormalizedJob[],
  profile: Profile,
) => Promise<Map<string, JobScoreFields>>; // key = `${source}:${externalId}`

export interface IngestSummary {
  fetched: number;
  duplicates: number;
  dropped: number;
  droppedDetail: Dropped[];
  added: number;
  updated: number;
}

export async function ingest(
  db: Database.Database,
  jobs: NormalizedJob[],
  profile: Profile,
  opts: { score: Scorer | null },
): Promise<IngestSummary> {
  const { fresh, duplicates } = dedup(db, jobs);
  const { kept, dropped } = prefilter(fresh, profile);

  const scores = opts.score ? await opts.score(kept, profile) : new Map<string, JobScoreFields>();

  let added = 0;
  let updated = 0;
  for (const job of kept) {
    const r = upsertJob(db, job, scores.get(`${job.source}:${job.externalId}`));
    if (r.inserted) added++;
    else updated++;
  }
  return {
    fetched: jobs.length, duplicates: duplicates.length, dropped: dropped.length,
    droppedDetail: dropped, added, updated,
  };
}
```
Run: `npx vitest run test/ingest/pipeline.test.ts` → PASS.

- [ ] **Step 7: Commit**

```bash
git add src/ingest test/ingest
git commit -m "feat(ingest): dedup, deterministic prefilter, injectable ingest pipeline"
```

---

## Task 8: `find --no-score` command + table UI

**Files:**
- Create: `src/ui/table.ts`, `src/commands/find.ts`, `test/ui/table.test.ts`, `test/commands/find.test.ts`
- Modify: `src/cli.ts` (register `find`)

- [ ] **Step 1: Write the failing test for the table formatter**

`test/ui/table.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { formatTable } from '../../src/ui/table.js';

describe('formatTable', () => {
  it('renders aligned columns with a header', () => {
    const out = formatTable(['ID', 'Title'], [['1', 'Senior Eng'], ['2', 'Staff Eng']]);
    const lines = out.split('\n');
    expect(lines[0]).toMatch(/ID\s+Title/);
    expect(lines).toHaveLength(4); // header + separator + 2 rows
  });

  it('handles empty rows', () => {
    expect(formatTable(['A'], [])).toContain('A');
  });
});
```

- [ ] **Step 2: Run red, implement `src/ui/table.ts`**

```ts
export function formatTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const pad = (cells: string[]) => cells.map((c, i) => (c ?? '').padEnd(widths[i])).join('  ').trimEnd();
  const sep = widths.map((w) => '-'.repeat(w)).join('  ');
  return [pad(headers), sep, ...rows.map(pad)].join('\n');
}
```
Run: `npx vitest run test/ui/table.test.ts` → PASS.

- [ ] **Step 3: Write the failing test for the `find` handler (mocked adapters + temp db)**

`test/commands/find.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openDb, migrate, getJobs } from '../../src/db/index.js';
import { runFind } from '../../src/commands/find.js';
import type { Profile } from '../../src/profile/schema.js';
import type { NormalizedJob, WatchlistEntry } from '../../src/sources/types.js';

const profile: Profile = {
  version: 1, updatedAt: '', basics: { name: '', headline: '', yearsExperience: 8, summary: '' },
  skills: { core: [], familiar: [] }, experience: [], notes: [],
  preferences: { targetRoles: [], seniority: [], locations: [], remote: 'any', maxCommuteMiles: null, minBaseComp: null, mustHave: [], dealbreakers: [] },
};
const job = (id: string): NormalizedJob => ({
  source: 'greenhouse', externalId: id, company: 'Acme', title: 'Senior Eng', url: `http://${id}`,
  location: 'Remote', remote: true, description: 'TS', postedAt: null, raw: {},
});

describe('runFind', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => { db = openDb(':memory:'); migrate(db); });

  it('fetches from each watchlist entry via injected adapters and persists', async () => {
    const watchlist: WatchlistEntry[] = [{ source: 'greenhouse', slug: 'acme', name: 'Acme' }];
    const fetchAdapter = vi.fn().mockResolvedValue([job('a'), job('b')]);
    const summary = await runFind({
      db, profile, watchlist, score: null,
      fetchEntry: fetchAdapter, log: () => {},
    });
    expect(fetchAdapter).toHaveBeenCalledOnce();
    expect(summary.added).toBe(2);
    expect(getJobs(db, {})).toHaveLength(2);
  });

  it('isolates a failing watchlist entry', async () => {
    const watchlist: WatchlistEntry[] = [
      { source: 'greenhouse', slug: 'bad' },
      { source: 'lever', slug: 'good' },
    ];
    const fetchEntry = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([job('c')]);
    const summary = await runFind({ db, profile, watchlist, score: null, fetchEntry, log: () => {} });
    expect(summary.added).toBe(1); // the good one still landed
  });
});
```

- [ ] **Step 4: Run red, implement `src/commands/find.ts`**

```ts
import type Database from 'better-sqlite3';
import { adapters } from '../sources/index.js';
import type { NormalizedJob, WatchlistEntry } from '../sources/types.js';
import type { Profile } from '../profile/schema.js';
import { ingest, type IngestSummary, type Scorer } from '../ingest/pipeline.js';
import { formatTable } from '../ui/table.js';
import { getJobs } from '../db/index.js';

export interface RunFindDeps {
  db: Database.Database;
  profile: Profile;
  watchlist: WatchlistEntry[];
  score: Scorer | null;
  keepDropped?: boolean;
  limit?: number;
  minScore?: number;
  // injectable for tests; defaults to the real adapter registry
  fetchEntry?: (entry: WatchlistEntry) => Promise<NormalizedJob[]>;
  log?: (msg: string) => void;
}

export async function runFind(deps: RunFindDeps): Promise<IngestSummary> {
  const log = deps.log ?? ((m: string) => console.log(m));
  const fetchEntry = deps.fetchEntry ?? ((e: WatchlistEntry) => adapters[e.source].fetchJobs(e));

  const all: NormalizedJob[] = [];
  for (const entry of deps.watchlist) {
    try {
      const jobs = await fetchEntry(entry);
      all.push(...jobs);
    } catch (err) {
      console.error(`  ! ${entry.source}:${entry.slug} failed: ${(err as Error).message}`);
    }
  }

  const summary = await ingest(deps.db, all, deps.profile, { score: deps.score });

  // Always log dropped reasons to stderr (Spec §6.3)
  if (summary.dropped > 0) {
    console.error(`Prefilter dropped ${summary.dropped} job(s):`);
    for (const d of summary.droppedDetail) console.error(`  - ${d.job.title} @ ${d.job.company}: ${d.reason}`);
  }
  if (deps.keepDropped) {
    log('\nDropped (not persisted):');
    log(formatTable(['Title', 'Company', 'Reason'], summary.droppedDetail.map((d) => [d.job.title, d.job.company, d.reason])));
  }

  const rows = getJobs(deps.db, { minScore: deps.minScore, limit: deps.limit });
  log(`\nFetched ${summary.fetched}, added ${summary.added}, updated ${summary.updated}, dropped ${summary.dropped}.`);
  log(formatTable(
    ['ID', 'Score', 'Status', 'Title', 'Company', 'Location'],
    rows.map((r) => [String(r.id), r.score == null ? '—' : String(r.score), r.status, r.title, r.company, r.location ?? '']),
  ));
  return summary;
}
```

- [ ] **Step 5: Run green**

Run: `npx vitest run test/commands/find.test.ts`
Expected: PASS (both).

- [ ] **Step 6: Register `find` in `src/cli.ts`**

Add inside `cli.ts` before `program.parseAsync`:
```ts
import { loadConfig } from './config.js';
import { openDb, migrate } from './db/index.js';
import { loadProfile } from './profile/store.js';
import { loadWatchlist } from './sources/index.js';
import { runFind } from './commands/find.js';

program
  .command('find')
  .description('Crawl the ATS watchlist, normalize, dedup, prefilter, persist, and rank.')
  .option('--limit <n>', 'max rows to display', (v) => parseInt(v, 10))
  .option('--min-score <n>', 'minimum score to display', (v) => parseInt(v, 10))
  .option('--no-score', 'skip LLM scoring (prefilter only)') // scoring wired in Plan 2
  .option('--keep-dropped', 'also print prefilter-dropped jobs')
  .action(async (opts) => {
    const cfg = loadConfig();
    const profile = loadProfile(cfg);
    if (!profile) throw new Error('No profile found. Run `job-scout profile build` first.');
    const db = openDb(cfg.dbPath); migrate(db);
    const watchlist = loadWatchlist(cfg.companiesFile);
    await runFind({ db, profile, watchlist, score: null, keepDropped: opts.keepDropped, limit: opts.limit, minScore: opts.minScore });
  });
```
> `--no-score` currently has no effect (no scorer exists until Plan 2); the flag is wired now so the CLI surface is stable. Plan 2 replaces `score: null` with the real scorer unless `--no-score`.

Run: `npm run build && node dist/cli.js find --help`
Expected: help shows all four options. (Running `find` for real needs a profile + `companies.yaml`; that's Plan 2 territory.)

- [ ] **Step 7: Commit**

```bash
git add src/ui src/commands/find.ts src/cli.ts test/ui test/commands/find.test.ts
git commit -m "feat(find): watchlist crawl + ranked table (prefilter-only), cli wiring"
```

---

## Task 9: `pipeline` + `status` commands

**Files:**
- Create: `src/commands/pipeline.ts`, `test/commands/pipeline.test.ts`
- Modify: `src/cli.ts` (register `pipeline`, `status`)

- [ ] **Step 1: Write the failing test**

`test/commands/pipeline.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, migrate, upsertJob, getJobById } from '../../src/db/index.js';
import { renderPipeline, changeStatus } from '../../src/commands/pipeline.js';
import type { NormalizedJob } from '../../src/sources/types.js';

const j = (id: string): NormalizedJob => ({
  source: 'greenhouse', externalId: id, company: 'Acme', title: 'Senior Eng', url: `http://${id}`,
  location: 'Remote', remote: true, description: '', postedAt: null, raw: {},
});

describe('pipeline + status', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => { db = openDb(':memory:'); migrate(db); });

  it('renders a table filtered by status', () => {
    const a = upsertJob(db, j('a'));
    upsertJob(db, j('b'));
    changeStatus(db, a.id, 'interested');
    const out = renderPipeline(db, { status: 'interested' });
    expect(out).toContain('Acme');
    expect(out).toContain(String(a.id));
  });

  it('changeStatus validates the target state', () => {
    const a = upsertJob(db, j('a'));
    expect(() => changeStatus(db, a.id, 'bogus' as never)).toThrow(/invalid status/i);
    expect(changeStatus(db, a.id, 'applied')).toBe(true);
    expect(getJobById(db, a.id)!.status).toBe('applied');
  });

  it('changeStatus throws on unknown job id', () => {
    expect(() => changeStatus(db, 999, 'applied')).toThrow(/no job/i);
  });
});
```

- [ ] **Step 2: Run red, implement `src/commands/pipeline.ts`**

```ts
import type Database from 'better-sqlite3';
import { getJobs, getJobById, setStatus, type JobStatus } from '../db/index.js';
import { formatTable } from '../ui/table.js';

const STATUSES: JobStatus[] = ['new', 'interested', 'applied', 'rejected'];

export function renderPipeline(
  db: Database.Database,
  filter: { status?: JobStatus; minScore?: number } = {},
): string {
  const rows = getJobs(db, filter);
  return formatTable(
    ['ID', 'Score', 'Status', 'Title', 'Company', 'Location'],
    rows.map((r) => [String(r.id), r.score == null ? '—' : String(r.score), r.status, r.title, r.company, r.location ?? '']),
  );
}

export function changeStatus(db: Database.Database, id: number, status: JobStatus): boolean {
  if (!STATUSES.includes(status)) throw new Error(`Invalid status "${status}". Use one of: ${STATUSES.join(', ')}`);
  if (!getJobById(db, id)) throw new Error(`No job with id ${id}.`);
  return setStatus(db, id, status);
}
```
Run: `npx vitest run test/commands/pipeline.test.ts` → PASS (all 3).

- [ ] **Step 3: Register `pipeline` + `status` in `src/cli.ts`**

```ts
import { renderPipeline, changeStatus } from './commands/pipeline.js';
import type { JobStatus } from './db/index.js';

program
  .command('pipeline')
  .description('View tracked jobs.')
  .option('--status <status>', 'filter by status')
  .option('--min-score <n>', 'minimum score', (v) => parseInt(v, 10))
  .action((opts) => {
    const cfg = loadConfig();
    const db = openDb(cfg.dbPath); migrate(db);
    console.log(renderPipeline(db, { status: opts.status as JobStatus | undefined, minScore: opts.minScore }));
  });

program
  .command('status')
  .description('Advance a job between new | interested | applied | rejected.')
  .argument('<job-id>', 'job id', (v) => parseInt(v, 10))
  .argument('<state>', 'new | interested | applied | rejected')
  .action((jobId: number, state: string) => {
    const cfg = loadConfig();
    const db = openDb(cfg.dbPath); migrate(db);
    changeStatus(db, jobId, state as JobStatus);
    console.log(`Job ${jobId} → ${state}`);
  });
```

Run: `npm run build && node dist/cli.js pipeline --help && node dist/cli.js status --help`
Expected: both helps render.

- [ ] **Step 4: Full green + lint, then commit**

Run:
```bash
npm test
npm run lint
npm run build
```
Expected: all tests pass; lint clean (boundary rule passes — no core→agent imports exist yet); build succeeds.

```bash
git add src/commands/pipeline.ts src/cli.ts test/commands/pipeline.test.ts
git commit -m "feat(pipeline): view + status commands (human review gate)"
```

---

## Plan 1 Self-Review (run before handoff)

- [ ] **Spec coverage:** §2 principles (deterministic core ✓, human gate via `status` ✓, living-profile data gitignored ✓ Task 1), §3 commands (`find --no-score`, `pipeline`, `status` ✓; `profile build`/`add`/`tailor` → Plan 2), §4 layout ✓, §5 profile schema/store/md ✓ (pdf ✓; interview → Plan 2), §6 sources + ingest + prefilter ✓ (scoring → Plan 2), §7 DB schema + status-preserving upsert ✓, §8 config/tiering constants ✓, §13 stack ✓.
- [ ] **Placeholder scan:** no TBD/TODO; every step has runnable code/commands.
- [ ] **Type consistency:** `NormalizedJob`, `JobScoreFields`, `Scorer` (key `${source}:${externalId}`), `JobStatus`, `IngestSummary` used identically across db/ingest/find/pipeline. `fetchJobs(entry, fetchImpl?)` signature consistent across adapters and tests.
- [ ] **Deferred-to-Plan-2 markers:** `find` passes `score: null`; `--no-score` is inert; `no-restricted-imports` becomes load-bearing when `src/agent/**` is added.

**Exit criteria:** `npm test`, `npm run lint`, `npm run build` all green; `job-scout find/pipeline/status --help` work. Plan 2 starts from here.

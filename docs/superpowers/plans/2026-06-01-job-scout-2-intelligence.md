# job-scout — Plan 2: Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the LLM layer on top of Plan 1's deterministic core — structured-output scoring wired into `find`, the interactive `profile build`/`update`/`show`, the `add` URL-ingest command, `tailor` (resume summary + cover letter + fit notes), the `update_profile` feedback loop, and the proactive gap-interview during `tailor`.

**Architecture:** All Anthropic calls go through a single `src/agent/llm.ts` wrapper exposing one primitive — `structuredCall<T>()` — which forces a tool call, validates the result with the caller's zod schema, and does one repair retry (Spec §6.4, §11). Feature modules (`scoring`, `profile/build`, `tailor`) compose that primitive with real prompts in `src/agent/prompts/`. The `update_profile` agentic tool-use loop lets `find`/`tailor` propose profile edits the user confirms. Tests mock at the `llm`/`fetcher` boundary, so no API key is needed to test.

**Tech Stack:** Adds `@anthropic-ai/sdk`, `@anthropic-ai/claude-agent-sdk`, `zod-to-json-schema`. Everything else from Plan 1.

> **Prereq:** Plan 1 complete and green. **Read the spec** (`docs/superpowers/specs/2026-06-01-job-scout-design.md`), especially §5, §6.3–6.4, §8, §10.
>
> **Deviation flagged for the user (confirm before Task 13):** Spec §10 says "consume the official `fetch` MCP" for URL retrieval. This plan instead retrieves posting text via direct `fetch` + `html-to-text` in `src/fetcher/posting.ts` — deterministic and unit-testable — and concentrates the MCP story on the _published_ server (Plan 3) plus wiring the fetch MCP into the agent loops where it genuinely helps. If you require literal fetch-MCP consumption for retrieval, adjust Task 13's `fetcher` to call the MCP via the Agent SDK instead; the module contract stays the same.
>
> **SDK verification:** the exact `@anthropic-ai/sdk` tool-use surface and `@anthropic-ai/claude-agent-sdk` server helpers should be confirmed against the installed versions (consult the `claude-api` skill if available). Where this plan shows SDK calls, the _shapes_ (system prompt, `tools` with `input_schema`, `tool_use`/`tool_result` blocks) are stable; adapt field names only if the installed version differs. Module signatures must not change.

---

## File Structure (Plan 2)

| File                                                             | Responsibility                                                                      |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `src/agent/llm.ts`                                               | `structuredCall<T>()` — forced-tool structured output + zod validate + repair retry |
| `src/agent/client.ts`                                            | Anthropic client factory; reads key/model from config                               |
| `src/agent/prompts/score.ts`                                     | scoring system prompt + rubric text                                                 |
| `src/agent/prompts/interview.ts`                                 | interview question-generation prompt                                                |
| `src/agent/prompts/synthesize-profile.ts`                        | profile synthesis prompt                                                            |
| `src/agent/prompts/tailor.ts`                                    | tailoring prompt (no-fabrication contract)                                          |
| `src/agent/prompts/tailor-gap-interview.ts`                      | gap identification + question generation                                            |
| `src/agent/tools/update-profile.ts`                              | the `update_profile` tool definition + apply logic                                  |
| `src/scoring/rubric.ts`                                          | rubric constant + `JobScore` zod schema                                             |
| `src/scoring/score.ts`                                           | `scoreJobs()` Scorer using `structuredCall` (batched)                               |
| `src/profile/build.ts`                                           | interview orchestration + synthesis                                                 |
| `src/profile/interview.ts`                                       | readline Q&A driver (injectable prompter)                                           |
| `src/fetcher/posting.ts`                                         | `fetchPostingText(url)` → `{ title?, company?, text }`                              |
| `src/tailor/tailor.ts`                                           | `tailorPosting()` → write docs + record application                                 |
| `src/commands/{profile,add,tailor}.ts`                           | command handlers                                                                    |
| Modify: `src/commands/find.ts`, `src/cli.ts`, `eslint.config.js` | wire scoring + new commands; agent boundary override                                |

---

## Task 10: Anthropic deps + `structuredCall` primitive + eslint override

**Files:**

- Modify: `package.json` (deps)
- Create: `src/agent/client.ts`, `src/agent/llm.ts`, `test/agent/llm.test.ts`

- [ ] **Step 1: Add deps**

Run:

```bash
npm install @anthropic-ai/sdk @anthropic-ai/claude-agent-sdk zod-to-json-schema
```

- [ ] **Step 2: Confirm the import-boundary scoping (no change needed)**

Plan 1 already scoped the SDK `no-restricted-imports` ban to the **deterministic core globs only** (Spec §4). `src/agent/**`, `src/scoring/score.ts`, `src/tailor/**`, `src/fetcher/**`, `src/commands/**`, and `src/mcp/**` are outside that glob, so they may import the SDK (directly in `agent/`, indirectly elsewhere via `src/agent/llm`). No override is required. Verify by running `npm run lint` after Task 10 and confirming the core boundary still fails on a deliberate test import (optional sanity check: temporarily add `import '@anthropic-ai/sdk'` to `src/db/index.ts`, see lint error, remove it).

- [ ] **Step 3: Implement `src/agent/client.ts`**

```ts
import Anthropic from '@anthropic-ai/sdk';
import type { Config } from '../config.js';

export function createClient(cfg: Config): Anthropic {
  if (!cfg.anthropicApiKey) {
    throw new Error('ANTHROPIC_API_KEY is not set. Add it to your environment or .env file.');
  }
  return new Anthropic({ apiKey: cfg.anthropicApiKey });
}
```

- [ ] **Step 4: Write the failing test for `structuredCall` (mock the client)**

`test/agent/llm.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { structuredCall } from '../../src/agent/llm.js';

const schema = z.object({ score: z.number() });
const toolUse = (input: unknown) => ({
  content: [{ type: 'tool_use', name: 'emit', id: 't1', input }],
});

describe('structuredCall', () => {
  it('returns validated tool input', async () => {
    const client = { messages: { create: vi.fn().mockResolvedValue(toolUse({ score: 9 })) } };
    const out = await structuredCall({
      client: client as never,
      model: 'm',
      system: 's',
      user: 'u',
      toolName: 'emit',
      schema,
    });
    expect(out).toEqual({ score: 9 });
  });

  it('repairs once on invalid output then succeeds', async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce(toolUse({ score: 'NaN' })) // invalid
      .mockResolvedValueOnce(toolUse({ score: 7 })); // repaired
    const client = { messages: { create } };
    const out = await structuredCall({
      client: client as never,
      model: 'm',
      system: 's',
      user: 'u',
      toolName: 'emit',
      schema,
    });
    expect(out).toEqual({ score: 7 });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('throws after a failed repair', async () => {
    const create = vi.fn().mockResolvedValue(toolUse({ score: 'x' }));
    const client = { messages: { create } };
    await expect(
      structuredCall({
        client: client as never,
        model: 'm',
        system: 's',
        user: 'u',
        toolName: 'emit',
        schema,
      }),
    ).rejects.toThrow(/validation/i);
    expect(create).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 5: Run red, implement `src/agent/llm.ts`**

```ts
import type Anthropic from '@anthropic-ai/sdk';
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { z } from 'zod';

export interface StructuredCallArgs<T> {
  client: Anthropic;
  model: string;
  system: string;
  user: string;
  toolName: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
}

export async function structuredCall<T>(args: StructuredCallArgs<T>): Promise<T> {
  const { client, model, system, user, toolName, schema, maxTokens = 2048 } = args;
  const inputSchema = zodToJsonSchema(schema, { target: 'openApi3' }) as Record<string, unknown>;
  const tool = {
    name: toolName,
    description: `Emit the result as structured ${toolName} data.`,
    input_schema: inputSchema,
  };

  const call = (extra: string) =>
    client.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      tools: [tool as never],
      tool_choice: { type: 'tool', name: toolName } as never,
      messages: [{ role: 'user', content: user + extra }],
    });

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await call(
      attempt === 0
        ? ''
        : '\n\nYour previous response failed schema validation. Re-emit valid data.',
    );
    const block = (res.content as { type: string; name?: string; input?: unknown }[]).find(
      (b) => b.type === 'tool_use',
    );
    const parsed = schema.safeParse(block?.input);
    if (parsed.success) return parsed.data;
    if (attempt === 1)
      throw new Error(`Structured output failed validation: ${parsed.error.message}`);
  }
  throw new Error('unreachable');
}
```

- [ ] **Step 6: Run green + commit**

Run: `npx vitest run test/agent/llm.test.ts && npm run lint`
Expected: PASS; lint clean (agent override lets the SDK import through, core boundary intact).

```bash
git add package.json src/agent test/agent/llm.test.ts
git commit -m "feat(agent): structuredCall primitive (forced tool + zod validate + repair)"
```

---

## Task 11: Scoring (`scoring/rubric.ts`, `scoring/score.ts`) wired into `find`

**Files:**

- Create: `src/scoring/rubric.ts`, `src/agent/prompts/score.ts`, `src/scoring/score.ts`, `test/scoring/score.test.ts`
- Modify: `src/commands/find.ts` cli wiring (replace `score: null` with real scorer unless `--no-score`)

- [ ] **Step 1: Implement `src/scoring/rubric.ts`**

```ts
import { z } from 'zod';

export const JobScoreSchema = z.object({
  externalId: z.string(),
  score: z.number().min(0).max(100),
  matchedSkills: z.array(z.string()),
  missingSkills: z.array(z.string()),
  reasons: z.string(),
});
export const JobScoreBatchSchema = z.object({ scores: z.array(JobScoreSchema) });
export type JobScoreItem = z.infer<typeof JobScoreSchema>;

export const RUBRIC = `Score each job 0-100 for fit with THIS candidate, weighting:
- Skills/tech overlap with the candidate's core skills (highest weight)
- Seniority alignment with the candidate's target seniority
- Location/remote compatibility with the candidate's preferences
- Alignment with the candidate's target roles
0-39 weak, 40-69 plausible, 70-100 strong. Be honest and specific; do not inflate.
For each job return matchedSkills (candidate strengths the role wants), missingSkills
(role requirements the candidate lacks), and 1-3 sentences of reasons.`;
```

- [ ] **Step 2: Implement `src/agent/prompts/score.ts`**

```ts
import type { Profile } from '../../profile/schema.js';
import { renderProfileMarkdown } from '../../profile/store.js';
import { RUBRIC } from '../../scoring/rubric.js';
import type { NormalizedJob } from '../../sources/types.js';

export const SCORE_SYSTEM = `You are a precise technical recruiter scoring job fit.\n${RUBRIC}`;

export function scoreUserPrompt(profile: Profile, jobs: NormalizedJob[]): string {
  const jobBlocks = jobs
    .map(
      (j) =>
        `### externalId: ${j.externalId}\nTitle: ${j.title}\nCompany: ${j.company}\nLocation: ${j.location ?? 'n/a'} (remote: ${j.remote ?? 'unknown'})\n${j.description.slice(0, 2500)}`,
    )
    .join('\n\n');
  return `CANDIDATE PROFILE:\n${renderProfileMarkdown(profile)}\n\nJOBS TO SCORE (return one score object per externalId):\n${jobBlocks}`;
}
```

- [ ] **Step 3: Write the failing test for `scoreJobs` (mock `structuredCall`)**

`test/scoring/score.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { makeScorer } from '../../src/scoring/score.js';
import type { NormalizedJob } from '../../src/sources/types.js';
import type { Profile } from '../../src/profile/schema.js';

const profile = {
  preferences: {},
  skills: { core: [], familiar: [] },
  basics: {},
  experience: [],
  notes: [],
} as unknown as Profile;
const job = (id: string): NormalizedJob => ({
  source: 'greenhouse',
  externalId: id,
  company: 'A',
  title: 'T',
  url: 'u',
  location: null,
  remote: null,
  description: 'd',
  postedAt: null,
  raw: {},
});

describe('makeScorer', () => {
  it('maps batch results back to job keys', async () => {
    const fakeCall = vi.fn().mockResolvedValue({
      scores: [
        { externalId: 'a', score: 80, matchedSkills: ['TS'], missingSkills: [], reasons: 'good' },
        { externalId: 'b', score: 30, matchedSkills: [], missingSkills: ['Go'], reasons: 'weak' },
      ],
    });
    const scorer = makeScorer({ client: {} as never, model: 'm', batchSize: 10, call: fakeCall });
    const result = await scorer([job('a'), job('b')], profile);
    expect(result.get('greenhouse:a')!.score).toBe(80);
    expect(result.get('greenhouse:b')!.missingSkills).toEqual(['Go']);
  });

  it('batches by batchSize', async () => {
    const fakeCall = vi.fn().mockImplementation(async (_c, _m, _p, jobs: NormalizedJob[]) => ({
      scores: jobs.map((j) => ({
        externalId: j.externalId,
        score: 50,
        matchedSkills: [],
        missingSkills: [],
        reasons: '',
      })),
    }));
    const scorer = makeScorer({ client: {} as never, model: 'm', batchSize: 2, call: fakeCall });
    await scorer([job('a'), job('b'), job('c')], profile);
    expect(fakeCall).toHaveBeenCalledTimes(2); // 2 + 1
  });
});
```

- [ ] **Step 4: Run red, implement `src/scoring/score.ts`**

```ts
import type Anthropic from '@anthropic-ai/sdk';
import { structuredCall } from '../agent/llm.js';
import { SCORE_SYSTEM, scoreUserPrompt } from '../agent/prompts/score.js';
import { JobScoreBatchSchema } from './rubric.js';
import type { JobScoreFields } from '../db/index.js';
import type { Scorer } from '../ingest/pipeline.js';
import type { NormalizedJob } from '../sources/types.js';
import type { Profile } from '../profile/schema.js';

type BatchCall = (
  client: Anthropic,
  model: string,
  profile: Profile,
  jobs: NormalizedJob[],
) => Promise<{
  scores: {
    externalId: string;
    score: number;
    matchedSkills: string[];
    missingSkills: string[];
    reasons: string;
  }[];
}>;

const defaultCall: BatchCall = (client, model, profile, jobs) =>
  structuredCall({
    client,
    model,
    system: SCORE_SYSTEM,
    user: scoreUserPrompt(profile, jobs),
    toolName: 'emit_scores',
    schema: JobScoreBatchSchema,
    maxTokens: 4096,
  });

export function makeScorer(deps: {
  client: Anthropic;
  model: string;
  batchSize: number;
  call?: BatchCall;
}): Scorer {
  const call = deps.call ?? defaultCall;
  return async (jobs, profile) => {
    const out = new Map<string, JobScoreFields>();
    for (let i = 0; i < jobs.length; i += deps.batchSize) {
      const batch = jobs.slice(i, i + deps.batchSize);
      try {
        const { scores } = await call(deps.client, deps.model, profile, batch);
        const byId = new Map(scores.map((s) => [s.externalId, s]));
        for (const j of batch) {
          const s = byId.get(j.externalId);
          if (s)
            out.set(`${j.source}:${j.externalId}`, {
              score: s.score,
              matchedSkills: s.matchedSkills,
              missingSkills: s.missingSkills,
              reasons: s.reasons,
            });
        }
      } catch (err) {
        console.error(
          `  ! scoring batch failed (${batch.length} jobs), leaving unscored: ${(err as Error).message}`,
        );
      }
    }
    return out;
  };
}
```

- [ ] **Step 5: Run green, then wire scoring into the `find` CLI action**

In `src/cli.ts` `find` action, replace the `score: null` wiring:

```ts
import { createClient } from './agent/client.js';
import { makeScorer } from './scoring/score.js';
// ...
.action(async (opts) => {
  const cfg = loadConfig();
  const profile = loadProfile(cfg);
  if (!profile) throw new Error('No profile found. Run `job-scout profile build` first.');
  const db = openDb(cfg.dbPath); migrate(db);
  const watchlist = loadWatchlist(cfg.companiesFile);
  const score = opts.score === false ? null
    : makeScorer({ client: createClient(cfg), model: cfg.models.worker, batchSize: cfg.scoringBatchSize });
  await runFind({ db, profile, watchlist, score, keepDropped: opts.keepDropped, limit: opts.limit, minScore: opts.minScore });
});
```

> commander sets `opts.score === false` when `--no-score` is passed (negated boolean option). The deterministic `runFind` test from Plan 1 still passes (it injects `score: null`).

Run: `npx vitest run test/scoring && npm run build && npm run lint`
Expected: PASS / clean / build ok.

- [ ] **Step 6: Commit**

```bash
git add src/scoring src/agent/prompts/score.ts src/cli.ts test/scoring
git commit -m "feat(scoring): batched rubric scoring wired into find"
```

---

## Task 12: `profile build` / `update` / `show`

**Files:**

- Create: `src/agent/prompts/interview.ts`, `src/agent/prompts/synthesize-profile.ts`, `src/profile/interview.ts`, `src/profile/build.ts`, `src/commands/profile.ts`, `test/profile/build.test.ts`
- Modify: `src/cli.ts` (register `profile`)

- [ ] **Step 1: Implement the prompts**

`src/agent/prompts/interview.ts`:

```ts
export const INTERVIEW_SYSTEM = `You are an expert career coach preparing a job-search profile.
Given a candidate's resume/LinkedIn text, produce up to 8 high-value interview questions that
fill gaps the documents don't answer: target roles, locations and max commute, remote preference,
compensation floor, must-have technologies, dealbreakers, and any thin spots in their experience.
Ask only what materially improves job matching. Be concise.`;

export function interviewUserPrompt(sourceText: string, existing?: string): string {
  return (
    `RESUME / LINKEDIN TEXT:\n${sourceText.slice(0, 12000)}` +
    (existing
      ? `\n\nEXISTING PROFILE (refine, don't repeat what's already captured):\n${existing}`
      : '')
  );
}
```

`src/agent/prompts/synthesize-profile.ts`:

```ts
export const SYNTH_SYSTEM = `You synthesize a structured candidate profile from source documents
and interview answers. Use ONLY information present in the inputs — never invent employers, titles,
dates, or skills. Where the candidate gave preferences (location, comp, remote, dealbreakers),
record them precisely. Produce the profile via the emit_profile tool.`;

export function synthUserPrompt(sourceText: string, transcript: string, existing?: string): string {
  return (
    `SOURCE DOCUMENTS:\n${sourceText.slice(0, 14000)}\n\nINTERVIEW (Q/A):\n${transcript}` +
    (existing
      ? `\n\nEXISTING PROFILE (merge; keep confirmed fields unless changed):\n${existing}`
      : '')
  );
}
```

- [ ] **Step 2: Write the failing test for `buildProfile` (mock LLM + prompter)**

`test/profile/build.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { buildProfile } from '../../src/profile/build.js';
import type { Profile } from '../../src/profile/schema.js';

const synthesized: Profile = {
  version: 1,
  updatedAt: '2026-06-01T00:00:00.000Z',
  basics: { name: 'Chris', headline: 'FS Eng', yearsExperience: 8, summary: 's' },
  skills: { core: ['TS'], familiar: [] },
  experience: [],
  notes: [],
  preferences: {
    targetRoles: ['Senior FS'],
    seniority: ['senior'],
    locations: ['Remote'],
    remote: 'remote',
    maxCommuteMiles: 30,
    minBaseComp: null,
    mustHave: ['TypeScript'],
    dealbreakers: [],
  },
};

describe('buildProfile', () => {
  it('runs interview then synthesis and returns a valid profile', async () => {
    const genQuestions = vi.fn().mockResolvedValue({ questions: ['What roles?', 'Remote?'] });
    const ask = vi.fn().mockResolvedValueOnce('Senior FS').mockResolvedValueOnce('Remote only');
    const synth = vi.fn().mockResolvedValue(synthesized);

    const profile = await buildProfile({
      sourceText: 'resume text',
      existing: null,
      generateQuestions: genQuestions,
      ask,
      synthesize: synth,
    });

    expect(ask).toHaveBeenCalledTimes(2);
    expect(synth).toHaveBeenCalledOnce();
    expect(profile.preferences.maxCommuteMiles).toBe(30);
    // transcript was assembled from Q + A
    expect((synth.mock.calls[0][0] as { transcript: string }).transcript).toContain('Senior FS');
  });
});
```

- [ ] **Step 3: Run red, implement `src/profile/interview.ts` and `src/profile/build.ts`**

`src/profile/interview.ts` (readline prompter — the injectable `ask`):

```ts
import { createInterface } from 'node:readline/promises';

export function createPrompter(): (q: string) => Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return async (q: string) => {
    const a = await rl.question(`\n${q}\n> `);
    return a.trim();
  };
}

export function closePrompter(): void {
  // readline auto-closes on process exit; expose for explicit teardown if needed
}
```

`src/profile/build.ts`:

```ts
import type { Profile } from './schema.js';

export interface BuildProfileDeps {
  sourceText: string;
  existing: string | null; // rendered existing profile.md, if any
  generateQuestions: (
    sourceText: string,
    existing: string | null,
  ) => Promise<{ questions: string[] }>;
  ask: (question: string) => Promise<string>;
  synthesize: (args: {
    sourceText: string;
    transcript: string;
    existing: string | null;
  }) => Promise<Profile>;
}

export async function buildProfile(deps: BuildProfileDeps): Promise<Profile> {
  const { questions } = await deps.generateQuestions(deps.sourceText, deps.existing);
  const qa: string[] = [];
  for (const q of questions) {
    const a = await deps.ask(q);
    qa.push(`Q: ${q}\nA: ${a || '(skipped)'}`);
  }
  const profile = await deps.synthesize({
    sourceText: deps.sourceText,
    transcript: qa.join('\n\n'),
    existing: deps.existing,
  });
  return { ...profile, updatedAt: new Date().toISOString() };
}
```

- [ ] **Step 4: Run green, then implement `src/commands/profile.ts` (wires real LLM impls)**

```ts
import { z } from 'zod';
import type { Config } from '../config.js';
import { createClient } from '../agent/client.js';
import { structuredCall } from '../agent/llm.js';
import { INTERVIEW_SYSTEM, interviewUserPrompt } from '../agent/prompts/interview.js';
import { SYNTH_SYSTEM, synthUserPrompt } from '../agent/prompts/synthesize-profile.js';
import { ProfileSchema, type Profile } from '../profile/schema.js';
import { extractProfileSources } from '../profile/pdf.js';
import { loadProfile, saveProfile, renderProfileMarkdown } from '../profile/store.js';
import { buildProfile } from '../profile/build.js';
import { createPrompter } from '../profile/interview.js';

const QuestionsSchema = z.object({ questions: z.array(z.string()).max(8) });

export async function runProfileBuild(cfg: Config): Promise<void> {
  const client = createClient(cfg);
  const sources = await extractProfileSources(cfg.profileDir);
  if (sources.length === 0)
    throw new Error(
      `No PDFs found in ${cfg.profileDir}. Add your resume/LinkedIn export and retry.`,
    );
  const sourceText = sources.map((s) => `# ${s.file}\n${s.text}`).join('\n\n');
  const existingProfile = loadProfile(cfg);
  const existing = existingProfile ? renderProfileMarkdown(existingProfile) : null;
  const ask = createPrompter();

  const profile = await buildProfile({
    sourceText,
    existing,
    generateQuestions: (text, ex) =>
      structuredCall({
        client,
        model: cfg.models.worker,
        system: INTERVIEW_SYSTEM,
        user: interviewUserPrompt(text, ex ?? undefined),
        toolName: 'emit_questions',
        schema: QuestionsSchema,
      }),
    ask,
    synthesize: ({ sourceText, transcript, existing }) =>
      structuredCall({
        client,
        model: cfg.models.synth,
        system: SYNTH_SYSTEM,
        user: synthUserPrompt(sourceText, transcript, existing ?? undefined),
        toolName: 'emit_profile',
        schema: ProfileSchema,
        maxTokens: 4096,
      }),
  });

  saveProfile(cfg, profile);
  console.log(`\nProfile saved to ${cfg.profileJson} and ${cfg.profileMd}.`);
}

export async function runProfileUpdate(cfg: Config, note?: string): Promise<void> {
  const existing = loadProfile(cfg);
  if (!existing) throw new Error('No profile yet. Run `job-scout profile build` first.');
  const client = createClient(cfg);
  const transcript = note
    ? `Q: Apply this update.\nA: ${note}`
    : await (async () => {
        const ask = createPrompter();
        const a = await ask('What would you like to change or add to your profile?');
        return `Q: What to change?\nA: ${a}`;
      })();
  const updated = await structuredCall({
    client,
    model: cfg.models.synth,
    system: SYNTH_SYSTEM,
    user: synthUserPrompt('(see existing profile)', transcript, renderProfileMarkdown(existing)),
    toolName: 'emit_profile',
    schema: ProfileSchema,
    maxTokens: 4096,
  });
  saveProfile(cfg, { ...updated, updatedAt: new Date().toISOString() });
  console.log('Profile updated.');
}

export function runProfileShow(cfg: Config): void {
  const p = loadProfile(cfg);
  if (!p) throw new Error('No profile yet. Run `job-scout profile build` first.');
  console.log(renderProfileMarkdown(p));
}
```

- [ ] **Step 5: Register `profile` in `src/cli.ts`**

```ts
import { runProfileBuild, runProfileUpdate, runProfileShow } from './commands/profile.js';

const profile = program.command('profile').description('Build and maintain your living profile.');
profile
  .command('build')
  .description('Interview + synthesize from PDFs in ./profile/.')
  .action(async () => {
    await runProfileBuild(loadConfig());
  });
profile
  .command('update')
  .description('Incrementally edit the profile.')
  .option('--note <text>', 'freeform change to integrate')
  .action(async (o) => {
    await runProfileUpdate(loadConfig(), o.note);
  });
profile
  .command('show')
  .description('Print profile.md.')
  .action(() => {
    runProfileShow(loadConfig());
  });
```

Run: `npm test && npm run lint && npm run build && node dist/cli.js profile --help`
Expected: tests pass; lint/build clean; help lists build/update/show.

- [ ] **Step 6: Commit**

```bash
git add src/profile/build.ts src/profile/interview.ts src/agent/prompts/interview.ts src/agent/prompts/synthesize-profile.ts src/commands/profile.ts src/cli.ts test/profile/build.test.ts
git commit -m "feat(profile): interactive build/update/show with interview + synthesis"
```

---

## Task 13: `add` command — URL ingest

**Files:**

- Create: `src/fetcher/posting.ts`, `src/commands/add.ts`, `test/fetcher/posting.test.ts`, `test/commands/add.test.ts`
- Modify: `src/cli.ts` (register `add`)

> **Confirm the deviation note at the top of this plan before starting.**

- [ ] **Step 1: Write the failing test for `fetchPostingText` (mock fetch)**

`test/fetcher/posting.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { fetchPostingText, urlToNormalizedJob } from '../../src/fetcher/posting.js';

describe('fetchPostingText', () => {
  it('extracts readable text and a title from html', async () => {
    const html =
      '<html><head><title>Senior Engineer at Acme</title></head><body><h1>Senior Engineer</h1><p>We use TypeScript.</p></body></html>';
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, text: async () => html } as Response);
    const r = await fetchPostingText(
      'https://acme.example/jobs/1',
      fetchImpl as unknown as typeof fetch,
    );
    expect(r.title).toContain('Senior Engineer');
    expect(r.text).toContain('TypeScript');
  });
});

describe('urlToNormalizedJob', () => {
  it('produces a stable externalId from the url', () => {
    const a = urlToNormalizedJob('https://acme.example/jobs/1', {
      title: 'T',
      company: 'Acme',
      text: 'desc',
    });
    const b = urlToNormalizedJob('https://acme.example/jobs/1', {
      title: 'T',
      company: 'Acme',
      text: 'desc',
    });
    expect(a.externalId).toBe(b.externalId);
    expect(a.source).toBe('url');
    expect(a.description).toBe('desc');
  });
});
```

- [ ] **Step 2: Run red, implement `src/fetcher/posting.ts`**

```ts
import { createHash } from 'node:crypto';
import { stripHtml } from '../sources/http.js';
import type { NormalizedJob } from '../sources/types.js';

export interface PostingText {
  title?: string;
  company?: string;
  text: string;
}

export async function fetchPostingText(
  url: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PostingText> {
  const res = await fetchImpl(url, {
    headers: { 'user-agent': 'job-scout/0.1 (+https://github.com/)' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const html = await res.text();
  const title = /<title>([^<]*)<\/title>/i.exec(html)?.[1]?.trim();
  return { title, text: stripHtml(html) };
}

export function urlToNormalizedJob(url: string, posting: PostingText): NormalizedJob {
  const externalId = createHash('sha1').update(url).digest('hex').slice(0, 16);
  return {
    source: 'url',
    externalId,
    company: posting.company ?? new URL(url).hostname,
    title: posting.title ?? 'Untitled posting',
    url,
    location: null,
    remote: null,
    description: posting.text,
    postedAt: null,
    raw: { url, fetchedAt: new Date().toISOString() },
  };
}
```

> The model can refine `title`/`company`/`location` from `posting.text` during scoring; v1 keeps extraction deterministic and cheap. (If you later want LLM field extraction, add a `structuredCall` here — the contract is unchanged.)

- [ ] **Step 3: Write the failing test for `runAdd` (mock fetcher + temp db)**

`test/commands/add.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openDb, migrate, getJobs } from '../../src/db/index.js';
import { runAdd } from '../../src/commands/add.js';
import type { Profile } from '../../src/profile/schema.js';

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
} as unknown as Profile;

describe('runAdd', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    db = openDb(':memory:');
    migrate(db);
  });

  it('fetches each url, normalizes, and ingests', async () => {
    const fetchPosting = vi
      .fn()
      .mockResolvedValueOnce({ title: 'Senior Eng', text: 'TypeScript role' })
      .mockResolvedValueOnce({ title: 'Staff Eng', text: 'Node role' });
    const summary = await runAdd({
      db,
      profile,
      urls: ['https://a.example/1', 'https://b.example/2'],
      score: null,
      fetchPosting,
      log: () => {},
    });
    expect(fetchPosting).toHaveBeenCalledTimes(2);
    expect(summary.added).toBe(2);
    expect(getJobs(db, {}).map((j) => j.source)).toEqual(['url', 'url']);
  });

  it('isolates a failing url', async () => {
    const fetchPosting = vi
      .fn()
      .mockRejectedValueOnce(new Error('404'))
      .mockResolvedValueOnce({ title: 'OK', text: 'desc' });
    const summary = await runAdd({
      db,
      profile,
      urls: ['x', 'y'],
      score: null,
      fetchPosting,
      log: () => {},
    });
    expect(summary.added).toBe(1);
  });
});
```

- [ ] **Step 4: Run red, implement `src/commands/add.ts`**

```ts
import type Database from 'better-sqlite3';
import { fetchPostingText, urlToNormalizedJob, type PostingText } from '../fetcher/posting.js';
import { ingest, type IngestSummary, type Scorer } from '../ingest/pipeline.js';
import { getJobs } from '../db/index.js';
import { formatTable } from '../ui/table.js';
import type { NormalizedJob } from '../sources/types.js';
import type { Profile } from '../profile/schema.js';

export interface RunAddDeps {
  db: Database.Database;
  profile: Profile;
  urls: string[];
  score: Scorer | null;
  keepDropped?: boolean;
  fetchPosting?: (url: string) => Promise<PostingText>;
  log?: (msg: string) => void;
}

export async function runAdd(deps: RunAddDeps): Promise<IngestSummary> {
  const log = deps.log ?? ((m: string) => console.log(m));
  const fetchPosting = deps.fetchPosting ?? ((u: string) => fetchPostingText(u));
  const jobs: NormalizedJob[] = [];
  for (const url of deps.urls) {
    try {
      jobs.push(urlToNormalizedJob(url, await fetchPosting(url)));
    } catch (err) {
      console.error(`  ! ${url} failed: ${(err as Error).message}`);
    }
  }
  const summary = await ingest(deps.db, jobs, deps.profile, { score: deps.score });
  if (summary.dropped > 0) {
    console.error(`Prefilter dropped ${summary.dropped} job(s):`);
    for (const d of summary.droppedDetail) console.error(`  - ${d.job.title}: ${d.reason}`);
  }
  if (deps.keepDropped)
    log(
      formatTable(
        ['Title', 'Reason'],
        summary.droppedDetail.map((d) => [d.job.title, d.reason]),
      ),
    );
  const rows = getJobs(deps.db, {});
  log(`\nAdded ${summary.added}, updated ${summary.updated}, dropped ${summary.dropped}.`);
  log(
    formatTable(
      ['ID', 'Score', 'Title', 'Company'],
      rows.map((r) => [String(r.id), r.score == null ? '—' : String(r.score), r.title, r.company]),
    ),
  );
  return summary;
}
```

- [ ] **Step 5: Register `add` in `src/cli.ts`, run green, commit**

```ts
import { readFileSync } from 'node:fs';
import { runAdd } from './commands/add.js';

program
  .command('add')
  .description('Ingest specific posting URLs into the pipeline.')
  .argument('[urls...]', 'posting URLs')
  .option('--urls <file>', 'file with one URL per line')
  .option('--no-score', 'skip LLM scoring')
  .option('--keep-dropped', 'print prefilter-dropped jobs')
  .action(async (urlArgs: string[], opts) => {
    const cfg = loadConfig();
    const profile = loadProfile(cfg);
    if (!profile) throw new Error('No profile found. Run `job-scout profile build` first.');
    const db = openDb(cfg.dbPath);
    migrate(db);
    const fromFile = opts.urls
      ? readFileSync(opts.urls, 'utf8')
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    const urls = [...urlArgs, ...fromFile];
    if (urls.length === 0) throw new Error('Provide URLs as arguments or via --urls <file>.');
    const score =
      opts.score === false
        ? null
        : makeScorer({
            client: createClient(cfg),
            model: cfg.models.worker,
            batchSize: cfg.scoringBatchSize,
          });
    await runAdd({ db, profile, urls, score, keepDropped: opts.keepDropped });
  });
```

Run: `npm test && npm run lint && npm run build`
Expected: green / clean / ok.

```bash
git add src/fetcher src/commands/add.ts src/cli.ts test/fetcher test/commands/add.test.ts
git commit -m "feat(add): url ingest reusing the scoring pipeline"
```

---

## Task 14: `tailor` (no-interview path) + `update_profile` tool

**Files:**

- Create: `src/agent/prompts/tailor.ts`, `src/agent/tools/update-profile.ts`, `src/tailor/tailor.ts`, `src/commands/tailor.ts`, `test/tailor/tailor.test.ts`, `test/agent/update-profile.test.ts`
- Modify: `src/cli.ts` (register `tailor`)

- [ ] **Step 1: Implement the tailor prompt (no-fabrication contract — Spec Principle 4)**

`src/agent/prompts/tailor.ts`:

```ts
import { z } from 'zod';
import type { Profile } from '../../profile/schema.js';
import { renderProfileMarkdown } from '../../profile/store.js';

export const TailorOutputSchema = z.object({
  resumeSummary: z.string(), // markdown
  coverLetter: z.string(), // markdown
  fitNotes: z.string(), // markdown: why it matched, strengths, gaps
});
export type TailorOutput = z.infer<typeof TailorOutputSchema>;

export const TAILOR_SYSTEM = `You tailor job application materials for a candidate.
ABSOLUTE RULE: never invent employers, titles, dates, skills, or achievements. Every claim must
trace to the candidate profile (or to extra experience the candidate explicitly provided). If the
role wants something the candidate lacks, do not fabricate it — omit it or, in fitNotes, name it as
a gap. Write in the candidate's voice: specific, grounded, no fluff.
Produce three markdown documents via the emit_tailored tool:
- resumeSummary: a tailored professional-summary + highlights section emphasizing the most relevant real experience
- coverLetter: a concise, specific cover letter
- fitNotes: honest notes on why this matched, key strengths to lead with, and any gaps`;

export function tailorUserPrompt(profile: Profile, posting: string, extra?: string): string {
  return (
    `CANDIDATE PROFILE:\n${renderProfileMarkdown(profile)}\n\nJOB POSTING:\n${posting.slice(0, 8000)}` +
    (extra
      ? `\n\nADDITIONAL REAL EXPERIENCE THE CANDIDATE PROVIDED (you may use this):\n${extra}`
      : '')
  );
}
```

- [ ] **Step 2: Write the failing test for `tailorPosting` (mock synth + temp db) and `update_profile` apply**

`test/tailor/tailor.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDb, migrate, upsertJob, getApplication } from '../../src/db/index.js';
import { tailorPosting } from '../../src/tailor/tailor.js';
import type { Profile } from '../../src/profile/schema.js';
import type { NormalizedJob } from '../../src/sources/types.js';

const profile = {
  basics: { name: 'Chris' },
  skills: { core: [], familiar: [] },
  experience: [],
  notes: [],
  preferences: {},
} as unknown as Profile;
const job: NormalizedJob = {
  source: 'greenhouse',
  externalId: 'g1',
  company: 'Acme',
  title: 'Senior Eng',
  url: 'u',
  location: null,
  remote: null,
  description: 'TS role',
  postedAt: null,
  raw: {},
};

describe('tailorPosting', () => {
  let db: ReturnType<typeof openDb>;
  let outDir: string;
  beforeEach(() => {
    db = openDb(':memory:');
    migrate(db);
    outDir = mkdtempSync(path.join(tmpdir(), 'js-out-'));
  });

  it('writes three docs and records an application', async () => {
    const id = upsertJob(db, job).id;
    const synth = vi
      .fn()
      .mockResolvedValue({ resumeSummary: '# Summary', coverLetter: '# Cover', fitNotes: '# Fit' });
    const result = await tailorPosting({
      db,
      outputDir: outDir,
      profile,
      jobId: id,
      company: 'Acme',
      title: 'Senior Eng',
      postingText: 'TS role',
      synthesize: synth,
    });
    expect(existsSync(result.resumePath)).toBe(true);
    expect(readFileSync(result.coverPath, 'utf8')).toContain('Cover');
    expect(getApplication(db, id)).toBeTruthy();
  });
});
```

`test/agent/update-profile.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { applyProfileUpdate } from '../../src/agent/tools/update-profile.js';
import type { Profile } from '../../src/profile/schema.js';

const base: Profile = {
  version: 1,
  updatedAt: '',
  basics: { name: 'C', headline: '', yearsExperience: 8, summary: '' },
  skills: { core: ['TS'], familiar: [] },
  experience: [],
  notes: [],
  preferences: {
    targetRoles: [],
    seniority: [],
    locations: [],
    remote: 'any',
    maxCommuteMiles: null,
    minBaseComp: null,
    mustHave: [],
    dealbreakers: [],
  },
};

describe('applyProfileUpdate', () => {
  it('appends a note and sets a preference', () => {
    const next = applyProfileUpdate(base, {
      addNote: 'Prefers async teams',
      setPreferences: { maxCommuteMiles: 30 },
    });
    expect(next.notes).toContain('Prefers async teams');
    expect(next.preferences.maxCommuteMiles).toBe(30);
    expect(next.skills.core).toEqual(['TS']); // untouched
  });

  it('adds skills without duplicating', () => {
    const next = applyProfileUpdate(base, { addCoreSkills: ['TS', 'Kafka'] });
    expect(next.skills.core).toEqual(['TS', 'Kafka']);
  });
});
```

- [ ] **Step 3: Run red, implement `src/agent/tools/update-profile.ts` and `src/tailor/tailor.ts`**

`src/agent/tools/update-profile.ts`:

```ts
import { z } from 'zod';
import type { Profile } from '../../profile/schema.js';

export const UpdateProfileInput = z.object({
  reason: z.string().describe('Why this update is proposed (shown to the user for confirmation).'),
  addNote: z.string().optional(),
  addCoreSkills: z.array(z.string()).optional(),
  addExperienceHighlight: z.object({ company: z.string(), highlight: z.string() }).optional(),
  setPreferences: z
    .object({
      maxCommuteMiles: z.number().nullable().optional(),
      minBaseComp: z.number().nullable().optional(),
      remote: z.enum(['remote', 'hybrid', 'onsite', 'any']).optional(),
      mustHave: z.array(z.string()).optional(),
      dealbreakers: z.array(z.string()).optional(),
    })
    .optional(),
});
export type UpdateProfile = z.infer<typeof UpdateProfileInput>;

const uniq = (a: string[]) => [...new Set(a)];

export function applyProfileUpdate(
  profile: Profile,
  update: Omit<UpdateProfile, 'reason'>,
): Profile {
  const next: Profile = structuredClone(profile);
  if (update.addNote) next.notes = uniq([...next.notes, update.addNote]);
  if (update.addCoreSkills) next.skills.core = uniq([...next.skills.core, ...update.addCoreSkills]);
  if (update.addExperienceHighlight) {
    const exp = next.experience.find((e) => e.company === update.addExperienceHighlight!.company);
    if (exp) exp.highlights = uniq([...exp.highlights, update.addExperienceHighlight.highlight]);
    else
      next.notes = uniq([
        ...next.notes,
        `${update.addExperienceHighlight.company}: ${update.addExperienceHighlight.highlight}`,
      ]);
  }
  if (update.setPreferences) Object.assign(next.preferences, update.setPreferences);
  next.updatedAt = new Date().toISOString();
  return next;
}
```

`src/tailor/tailor.ts`:

```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { insertApplication } from '../db/index.js';
import type { Profile } from '../profile/schema.js';
import type { TailorOutput } from '../agent/prompts/tailor.js';

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

export interface TailorDeps {
  db: Database.Database;
  outputDir: string;
  profile: Profile;
  jobId?: number;
  company: string;
  title: string;
  postingText: string;
  extraExperience?: string;
  synthesize: (args: {
    profile: Profile;
    postingText: string;
    extra?: string;
  }) => Promise<TailorOutput>;
}

export interface TailorResult {
  dir: string;
  resumePath: string;
  coverPath: string;
  fitNotesPath: string;
}

export async function tailorPosting(deps: TailorDeps): Promise<TailorResult> {
  const out = await deps.synthesize({
    profile: deps.profile,
    postingText: deps.postingText,
    extra: deps.extraExperience,
  });
  const dir = path.join(deps.outputDir, `${slug(deps.company)}-${slug(deps.title)}`);
  mkdirSync(dir, { recursive: true });
  const resumePath = path.join(dir, 'resume-summary.md');
  const coverPath = path.join(dir, 'cover-letter.md');
  const fitNotesPath = path.join(dir, 'fit-notes.md');
  writeFileSync(resumePath, out.resumeSummary);
  writeFileSync(coverPath, out.coverLetter);
  writeFileSync(fitNotesPath, out.fitNotes);
  if (deps.jobId != null)
    insertApplication(deps.db, { jobId: deps.jobId, resumePath, coverPath, fitNotesPath });
  return { dir, resumePath, coverPath, fitNotesPath };
}
```

- [ ] **Step 4: Implement `src/commands/tailor.ts` (resolve input → posting text → tailor), `--no-interview` path only here**

```ts
import type { Config } from '../config.js';
import { readFileSync } from 'node:fs';
import { createClient } from '../agent/client.js';
import { structuredCall } from '../agent/llm.js';
import { TAILOR_SYSTEM, tailorUserPrompt, TailorOutputSchema } from '../agent/prompts/tailor.js';
import { openDb, migrate, getJobById } from '../db/index.js';
import { loadProfile } from '../profile/store.js';
import { fetchPostingText } from '../fetcher/posting.js';
import { tailorPosting } from '../tailor/tailor.js';

export interface TailorCliOpts {
  jobId?: number;
  url?: string;
  textFile?: string;
  opus?: boolean;
  interview?: boolean;
}

export async function runTailor(cfg: Config, opts: TailorCliOpts): Promise<void> {
  const profile = loadProfile(cfg);
  if (!profile) throw new Error('No profile found. Run `job-scout profile build` first.');
  const db = openDb(cfg.dbPath);
  migrate(db);
  const client = createClient(cfg);

  let company = 'company';
  let title = 'role';
  let postingText: string;
  let jobId: number | undefined;

  if (opts.jobId != null) {
    const job = getJobById(db, opts.jobId);
    if (!job) throw new Error(`No job with id ${opts.jobId}.`);
    jobId = job.id;
    company = job.company;
    title = job.title;
    postingText = job.description;
  } else if (opts.url) {
    const p = await fetchPostingText(opts.url);
    title = p.title ?? title;
    postingText = p.text;
  } else if (opts.textFile) {
    postingText = readFileSync(opts.textFile, 'utf8');
  } else {
    throw new Error('Provide a <job-id>, a URL, or --text <file>.');
  }

  // Plan 2 Task 16 inserts the optional gap-interview here when opts.interview !== false.
  const model = opts.opus ? cfg.models.synth : cfg.models.worker;
  const result = await tailorPosting({
    db,
    outputDir: cfg.outputDir,
    profile,
    jobId,
    company,
    title,
    postingText,
    synthesize: ({ profile, postingText, extra }) =>
      structuredCall({
        client,
        model,
        system: TAILOR_SYSTEM,
        user: tailorUserPrompt(profile, postingText, extra),
        toolName: 'emit_tailored',
        schema: TailorOutputSchema,
        maxTokens: 4096,
      }),
  });
  console.log(`\nTailored docs written to ${result.dir}`);
}
```

- [ ] **Step 5: Register `tailor` in `src/cli.ts`, run green, commit**

```ts
import { runTailor } from './commands/tailor.js';

program
  .command('tailor')
  .description('Generate tailored resume summary + cover letter for a posting.')
  .argument('[job-id]', 'a job id from the pipeline', (v) => parseInt(v, 10))
  .option('--url <url>', 'a posting URL')
  .option('--text <file>', 'a file containing the posting text')
  .option('--opus', 'use the synthesis (Opus) tier')
  .option('--no-interview', 'skip the gap-interview')
  .action(async (jobId: number | undefined, opts) => {
    await runTailor(loadConfig(), {
      jobId: Number.isNaN(jobId) ? undefined : jobId,
      url: opts.url,
      textFile: opts.text,
      opus: opts.opus,
      interview: opts.interview,
    });
  });
```

Run: `npm test && npm run lint && npm run build`
Expected: green / clean / ok.

```bash
git add src/agent/prompts/tailor.ts src/agent/tools/update-profile.ts src/tailor src/commands/tailor.ts src/cli.ts test/tailor test/agent/update-profile.test.ts
git commit -m "feat(tailor): no-fabrication tailoring + update_profile apply logic"
```

---

## Task 15: Wire `update_profile` proposals into `find` and `tailor`

**Files:**

- Create: `src/agent/propose.ts`, `test/agent/propose.test.ts`
- Modify: `src/commands/tailor.ts`, `src/commands/profile.ts` (confirm-and-save helper)

The `update_profile` tool is offered to the model in agentic flows; when called, the CLI shows the proposal and saves only on confirmation (Spec §10).

- [ ] **Step 1: Write the failing test for the confirm-and-apply helper (mock confirm + save)**

`test/agent/propose.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { confirmAndApply } from '../../src/agent/propose.js';
import type { Profile } from '../../src/profile/schema.js';

const profile = {
  notes: [],
  skills: { core: [], familiar: [] },
  experience: [],
  preferences: {},
} as unknown as Profile;

describe('confirmAndApply', () => {
  it('saves when the user confirms', async () => {
    const save = vi.fn();
    const next = await confirmAndApply({
      profile,
      update: { reason: 'Add commute', setPreferences: { maxCommuteMiles: 30 } },
      confirm: async () => true,
      save,
    });
    expect(save).toHaveBeenCalledOnce();
    expect(next!.preferences.maxCommuteMiles).toBe(30);
  });

  it('does nothing when the user declines', async () => {
    const save = vi.fn();
    const next = await confirmAndApply({
      profile,
      update: { reason: 'x', addNote: 'n' },
      confirm: async () => false,
      save,
    });
    expect(save).not.toHaveBeenCalled();
    expect(next).toBeNull();
  });
});
```

- [ ] **Step 2: Run red, implement `src/agent/propose.ts`**

```ts
import type { Profile } from '../profile/schema.js';
import { applyProfileUpdate, type UpdateProfile } from './tools/update-profile.js';

export interface ConfirmAndApplyDeps {
  profile: Profile;
  update: UpdateProfile;
  confirm: (reason: string) => Promise<boolean>;
  save: (next: Profile) => void;
}

export async function confirmAndApply(deps: ConfirmAndApplyDeps): Promise<Profile | null> {
  const ok = await deps.confirm(deps.update.reason);
  if (!ok) return null;
  const { reason: _reason, ...changes } = deps.update;
  const next = applyProfileUpdate(deps.profile, changes);
  deps.save(next);
  return next;
}
```

- [ ] **Step 3: Use it in `runTailor`/`runProfile*`**

After a tailor run, if the synthesis surfaced a proposed update (Task 16 produces these from the gap-interview), call `confirmAndApply` with a terminal yes/no prompt and `saveProfile`. Add a small prompter:

```ts
// in src/commands/tailor.ts
import { createPrompter } from '../profile/interview.js';
import { confirmAndApply } from '../agent/propose.js';
import { saveProfile } from '../profile/store.js';
// ...build a confirm fn:
const ask = createPrompter();
const confirm = async (reason: string) =>
  /^y/i.test(await ask(`Update your profile? ${reason} (y/N)`));
// after gathering proposals[] (Task 16):
// for (const u of proposals) await confirmAndApply({ profile, update: u, confirm, save: (p) => saveProfile(cfg, p) });
```

> This is wired concretely in Task 16 where proposals are generated. Keep the helper generic here.

Run: `npx vitest run test/agent/propose.test.ts && npm run lint`
Expected: PASS / clean.

```bash
git add src/agent/propose.ts test/agent/propose.test.ts src/commands/tailor.ts
git commit -m "feat(agent): confirm-and-apply for proposed profile updates"
```

---

## Task 16: Gap-interview during `tailor` (Spec §10)

**Files:**

- Create: `src/agent/prompts/tailor-gap-interview.ts`, `src/tailor/gap-interview.ts`, `test/tailor/gap-interview.test.ts`
- Modify: `src/commands/tailor.ts` (insert the interview before synthesis when interactive)

- [ ] **Step 1: Implement the prompt + schema**

`src/agent/prompts/tailor-gap-interview.ts`:

```ts
import { z } from 'zod';
import type { Profile } from '../../profile/schema.js';
import { renderProfileMarkdown } from '../../profile/store.js';

export const GapsSchema = z.object({
  gaps: z
    .array(
      z.object({
        skill: z.string(),
        question: z
          .string()
          .describe('A specific question drawing out real experience with this skill.'),
      }),
    )
    .max(3),
});
export type Gaps = z.infer<typeof GapsSchema>;

export const GAP_SYSTEM = `You compare a job posting to a candidate profile and find the TOP (max 3)
high-emphasis requirements the posting stresses that the profile covers thinly or not at all.
For each, write one specific question that would surface real, concrete experience (scale, the
candidate's role, what they built). Do NOT ask about things already well-evidenced in the profile.
If there are no meaningful gaps, return an empty list.`;

export function gapUserPrompt(profile: Profile, posting: string): string {
  return `CANDIDATE PROFILE:\n${renderProfileMarkdown(profile)}\n\nJOB POSTING:\n${posting.slice(0, 8000)}`;
}
```

- [ ] **Step 2: Write the failing test for the gap-interview orchestration**

`test/tailor/gap-interview.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { runGapInterview } from '../../src/tailor/gap-interview.js';
import type { Profile } from '../../src/profile/schema.js';

const profile = {
  skills: { core: ['TS'], familiar: [] },
  experience: [],
  notes: [],
  preferences: {},
  basics: {},
} as unknown as Profile;

describe('runGapInterview', () => {
  it('asks each gap question and returns extra experience + proposals', async () => {
    const identify = vi.fn().mockResolvedValue({
      gaps: [{ skill: 'Kafka', question: 'Tell me about your Kafka experience.' }],
    });
    const ask = vi.fn().mockResolvedValue('Ran Kafka at 1M msgs/sec for 3 years.');
    const { extraExperience, proposals } = await runGapInterview({
      profile,
      postingText: 'Kafka role',
      identifyGaps: identify,
      ask,
    });
    expect(extraExperience).toContain('Kafka');
    expect(proposals[0].reason).toMatch(/Kafka/);
    expect(proposals[0].addCoreSkills).toContain('Kafka');
  });

  it('skips a gap the user cannot speak to and proposes nothing for it', async () => {
    const identify = vi
      .fn()
      .mockResolvedValue({ gaps: [{ skill: 'COBOL', question: 'COBOL experience?' }] });
    const ask = vi.fn().mockResolvedValue('skip');
    const { extraExperience, proposals } = await runGapInterview({
      profile,
      postingText: 'x',
      identifyGaps: identify,
      ask,
    });
    expect(extraExperience).toBe('');
    expect(proposals).toHaveLength(0);
  });

  it('returns empty when there are no gaps', async () => {
    const identify = vi.fn().mockResolvedValue({ gaps: [] });
    const ask = vi.fn();
    const { proposals } = await runGapInterview({
      profile,
      postingText: 'x',
      identifyGaps: identify,
      ask,
    });
    expect(ask).not.toHaveBeenCalled();
    expect(proposals).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run red, implement `src/tailor/gap-interview.ts`**

```ts
import type { Profile } from '../profile/schema.js';
import type { Gaps } from '../agent/prompts/tailor-gap-interview.js';
import type { UpdateProfile } from '../agent/tools/update-profile.js';

const SKIP = /^(skip|no|none|n\/a|no experience)\.?$/i;

export interface GapInterviewDeps {
  profile: Profile;
  postingText: string;
  identifyGaps: (profile: Profile, postingText: string) => Promise<Gaps>;
  ask: (question: string) => Promise<string>;
}

export interface GapInterviewResult {
  extraExperience: string;
  proposals: UpdateProfile[];
}

export async function runGapInterview(deps: GapInterviewDeps): Promise<GapInterviewResult> {
  const { gaps } = await deps.identifyGaps(deps.profile, deps.postingText);
  const extras: string[] = [];
  const proposals: UpdateProfile[] = [];
  for (const gap of gaps) {
    const answer = (await deps.ask(gap.question)).trim();
    if (!answer || SKIP.test(answer)) continue;
    extras.push(`${gap.skill}: ${answer}`);
    proposals.push({
      reason: `You described ${gap.skill} experience: "${answer.slice(0, 80)}${answer.length > 80 ? '…' : ''}". Add it to your profile?`,
      addCoreSkills: [gap.skill],
      addNote: `${gap.skill}: ${answer}`,
    });
  }
  return { extraExperience: extras.join('\n'), proposals };
}
```

- [ ] **Step 4: Wire into `runTailor` (between input resolution and synthesis)**

In `src/commands/tailor.ts`, before the `tailorPosting` call:

```ts
import { runGapInterview } from '../tailor/gap-interview.js';
import { GAP_SYSTEM, gapUserPrompt, GapsSchema } from '../agent/prompts/tailor-gap-interview.js';
import { createPrompter } from '../profile/interview.js';
import { confirmAndApply } from '../agent/propose.js';
import { saveProfile } from '../profile/store.js';

let extraExperience: string | undefined;
let mutableProfile = profile;
if (opts.interview !== false && process.stdin.isTTY) {
  const ask = createPrompter();
  const { extraExperience: extra, proposals } = await runGapInterview({
    profile,
    postingText,
    identifyGaps: (p, posting) =>
      structuredCall({
        client,
        model: cfg.models.worker,
        system: GAP_SYSTEM,
        user: gapUserPrompt(p, posting),
        toolName: 'emit_gaps',
        schema: GapsSchema,
      }),
    ask,
  });
  extraExperience = extra || undefined;
  const confirm = async (reason: string) =>
    /^y/i.test(await ask(`Update your profile? ${reason} (y/N) `));
  for (const u of proposals) {
    const next = await confirmAndApply({
      profile: mutableProfile,
      update: u,
      confirm,
      save: (pp) => saveProfile(cfg, pp),
    });
    if (next) mutableProfile = next;
  }
}
```

Then pass `profile: mutableProfile` and `extraExperience` into `tailorPosting`.

> **MCP/non-interactive note (Spec §10):** the gap-interview only runs when `opts.interview !== false` **and** `process.stdin.isTTY`. The published MCP `tailor` tool (Plan 3) runs non-interactively and instead returns the identified gap questions in its result.

Run: `npm test && npm run lint && npm run build`
Expected: green / clean / ok.

- [ ] **Step 5: Commit**

```bash
git add src/agent/prompts/tailor-gap-interview.ts src/tailor/gap-interview.ts src/commands/tailor.ts test/tailor/gap-interview.test.ts
git commit -m "feat(tailor): proactive gap-interview that enriches docs and proposes profile updates"
```

---

## Plan 2 Self-Review (run before handoff)

- [ ] **Spec coverage:** §5 interview/build/update/show ✓ (Task 12), §6.3–6.4 scoring rubric + batch + repair ✓ (Tasks 10–11), §3 `add` ✓ (13), `tailor` ✓ (14), §10 `update_profile` loop ✓ (15) + gap-interview ✓ (16), §8 model tiering (worker default, synth for build + `--opus`) ✓, Principle 4 no-fabrication contract ✓ (14, 16).
- [ ] **Placeholder scan:** none; every step has runnable code. Task 15's wiring is illustrative but concrete and finalized in Task 16.
- [ ] **Type consistency:** `Scorer` key `${source}:${externalId}` matches Plan 1; `TailorOutput`, `Gaps`, `UpdateProfile`, `PostingText` used consistently; `structuredCall` `{ client, model, system, user, toolName, schema }` identical at all call sites.
- [ ] **Deviation:** URL retrieval via direct fetch (flagged at top) — confirm with user. MCP consumption deferred to the agent loops / Plan 3.
- [ ] **Boundary:** all SDK imports confined to `src/agent/**`, `src/scoring/**`, `src/tailor/**`, `src/commands/**`, `src/fetcher/**` (none in `src/{config,db,profile/schema,profile/store,sources,ingest,ui}`); eslint override only loosens `src/agent/**`. Verify `scoring`/`tailor`/`fetcher` are allowed to import the SDK indirectly via `src/agent/llm` (they import `agent/llm`, not the SDK directly) — confirm lint stays green.

**Exit criteria:** `npm test`, `npm run lint`, `npm run build` green; an end-to-end manual run (`profile build` → `find` → `status` → `tailor`) works with a real API key.

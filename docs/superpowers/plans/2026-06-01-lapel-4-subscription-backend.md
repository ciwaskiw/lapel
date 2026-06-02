# lapel — Plan 4: Pluggable LLM Backend (subscription default) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let lapel run on a **Claude Pro/Max subscription** (via the Claude Code `claude` CLI in headless mode) with **no Anthropic API key**, while keeping the API path available — selected by `LAPEL_BACKEND=subscription|api` (default `subscription`).

**Architecture:** All LLM calls already funnel through one seam — `structuredCall()` in `src/agent/llm.ts`. We generalize that seam to an `LlmBackend` with a single `callOnce(req)` primitive, and provide two backends: `subscription` (spawns `claude -p … --json-schema … --output-format json`, reads `.structured_output`) and `api` (the existing Anthropic Messages forced-tool path). `structuredCall` keeps the generic zod-validate + one-repair-retry loop. The deterministic core is untouched; this change is confined to `src/agent/`, `config.ts`, and the ~5 call sites that construct the client.

**Tech Stack:** Adds nothing new (uses Node `child_process`). Requires the `claude` CLI installed + logged in for the subscription backend.

> **Verified against Claude Code 2.1.159 (2026-06-01):** headless `claude -p "<user>" --system-prompt "<sys>" --output-format json --json-schema '<schema>' --model sonnet --exclude-dynamic-system-prompt-sections` returns a JSON envelope; the schema-conformant object is in `.structured_output`; `.is_error` flags failures; `--model sonnet|opus` selects the tier; and the call succeeds with **`ANTHROPIC_API_KEY` unset** (uses the subscription). `--system-prompt` (replace) + `--exclude-dynamic-system-prompt-sections` keep per-call token/quota overhead low. `total_cost_usd` in the envelope is a notional estimate; on a subscription, usage counts against plan rate limits, not dollars.

---

## File Structure (Plan 4)

| File                                                                                   | Change                                                                                          |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/agent/backend.ts`                                                                 | **new** — `LlmBackend` interface + `RawCallRequest` + `createBackend(cfg)` factory              |
| `src/agent/backends/subscription.ts`                                                   | **new** — spawns the `claude` CLI; injectable `run` for tests                                   |
| `src/agent/backends/api.ts`                                                            | **new** — Anthropic Messages forced-tool `callOnce` (logic moved out of llm.ts)                 |
| `src/agent/llm.ts`                                                                     | **modify** — `structuredCall` takes a `backend`, keeps the validate+repair loop                 |
| `src/config.ts`                                                                        | **modify** — add `backend: 'subscription' \| 'api'` from `LAPEL_BACKEND` (default subscription) |
| `src/scoring/score.ts`                                                                 | **modify** — `makeScorer` takes `backend` instead of `client`                                   |
| `src/commands/profile.ts`, `src/commands/tailor.ts`, `src/mcp/server.ts`, `src/cli.ts` | **modify** — `createClient` → `createBackend`; pass `backend` to `structuredCall`/`makeScorer`  |
| `test/agent/llm.test.ts`                                                               | **modify** — mock a `backend.callOnce` instead of an Anthropic client                           |
| `test/agent/backends/subscription.test.ts`                                             | **new** — mock `run`, assert args + envelope parsing + error handling                           |
| `test/agent/backend.test.ts`                                                           | **new** — `createBackend` selection (subscription default; api requires key)                    |
| `test/scoring/score.test.ts`, `test/config.test.ts`                                    | **modify** — `client`→`backend`; add `LAPEL_BACKEND` default/override test                      |

`src/agent/client.ts` stays (used only by the api backend). NodeNext ESM → relative imports end in `.js`.

---

## Task 20: Backend abstraction + both backends + config + call sites (atomic)

> Implement as ONE coherent change so the build stays green. The plan code is exact; follow it.

**Step 1 — `src/agent/backend.ts`:**

```ts
import type { Config } from '../config.js';
import { createClient } from './client.js';
import { apiBackend } from './backends/api.js';
import { subscriptionBackend } from './backends/subscription.js';

export interface RawCallRequest {
  system: string;
  user: string; // already includes any repair hint
  jsonSchema: Record<string, unknown>;
  model: string; // full model id (e.g. claude-sonnet-4-6)
  toolName: string; // used by the api backend; subscription ignores
  maxTokens: number;
}

export interface LlmBackend {
  /** Make one model call and return the raw structured object (unvalidated). */
  callOnce(req: RawCallRequest): Promise<unknown>;
}

export function createBackend(cfg: Config): LlmBackend {
  if (cfg.backend === 'api') return apiBackend(createClient(cfg)); // throws if no API key
  return subscriptionBackend();
}
```

**Step 2 — `src/config.ts`:** add a `backend` field.

- In `Config`: `backend: 'subscription' | 'api';`
- In `loadConfig`: `backend: env.LAPEL_BACKEND === 'api' ? 'api' : 'subscription',`

**Step 3 — `src/agent/backends/api.ts`** (move the forced-tool logic out of llm.ts):

```ts
import type Anthropic from '@anthropic-ai/sdk';
import type { LlmBackend, RawCallRequest } from '../backend.js';

export function apiBackend(client: Anthropic): LlmBackend {
  return {
    async callOnce(req: RawCallRequest): Promise<unknown> {
      const tool = {
        name: req.toolName,
        description: `Emit the result as structured ${req.toolName} data.`,
        input_schema: req.jsonSchema,
      };
      const res = await client.messages.create({
        model: req.model,
        max_tokens: req.maxTokens,
        system: req.system,
        tools: [tool as never],
        tool_choice: { type: 'tool', name: req.toolName } as never,
        messages: [{ role: 'user', content: req.user }],
      });
      const block = (res.content as { type: string; input?: unknown }[]).find(
        (b) => b.type === 'tool_use',
      );
      return block?.input;
    },
  };
}
```

**Step 4 — `src/agent/backends/subscription.ts`:**

```ts
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import type { LlmBackend, RawCallRequest } from '../backend.js';

/** Map a full model id to the `claude --model` alias it accepts. */
export function modelAlias(model: string): string {
  if (/opus/i.test(model)) return 'opus';
  if (/haiku/i.test(model)) return 'haiku';
  return 'sonnet';
}

export type RunClaude = (args: string[], cwd: string) => Promise<{ stdout: string; code: number }>;

function defaultRun(command: string): RunClaude {
  return (args, cwd) =>
    new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stderr += d));
      child.on('error', (err) =>
        reject(
          new Error(
            `Could not run \`${command}\`: ${err.message}. Install Claude Code and log in, or set LAPEL_BACKEND=api with ANTHROPIC_API_KEY.`,
          ),
        ),
      );
      child.on('close', (code) => resolve({ stdout: stdout || stderr, code: code ?? 1 }));
    });
}

export function subscriptionBackend(opts: { command?: string; run?: RunClaude } = {}): LlmBackend {
  const command = opts.command ?? 'claude';
  const run = opts.run ?? defaultRun(command);
  return {
    async callOnce(req: RawCallRequest): Promise<unknown> {
      const args = [
        '-p',
        req.user,
        '--system-prompt',
        req.system,
        '--output-format',
        'json',
        '--json-schema',
        JSON.stringify(req.jsonSchema),
        '--model',
        modelAlias(req.model),
        '--exclude-dynamic-system-prompt-sections',
      ];
      const { stdout, code } = await run(args, tmpdir());
      let env: {
        is_error?: boolean;
        result?: string;
        subtype?: string;
        structured_output?: unknown;
      };
      try {
        env = JSON.parse(stdout);
      } catch {
        throw new Error(`claude returned non-JSON output (exit ${code}): ${stdout.slice(0, 300)}`);
      }
      if (code !== 0 || env.is_error) {
        throw new Error(`claude call failed: ${env.result ?? env.subtype ?? `exit ${code}`}`);
      }
      return env.structured_output;
    },
  };
}
```

**Step 5 — `src/agent/llm.ts`** (now backend-driven; keep the validate+repair loop):

```ts
import { zodToJsonSchema } from 'zod-to-json-schema';
import type { z } from 'zod';
import type { LlmBackend } from './backend.js';

export interface StructuredCallArgs<T> {
  backend: LlmBackend;
  model: string;
  system: string;
  user: string;
  toolName: string;
  schema: z.ZodType<T>;
  maxTokens?: number;
}

export async function structuredCall<T>(args: StructuredCallArgs<T>): Promise<T> {
  const { backend, model, system, user, toolName, schema, maxTokens = 2048 } = args;
  const jsonSchema = zodToJsonSchema(schema, { target: 'openApi3' }) as Record<string, unknown>;

  for (let attempt = 0; attempt < 2; attempt++) {
    const repaired =
      attempt === 0
        ? user
        : `${user}\n\nYour previous response failed schema validation. Re-emit valid data.`;
    const raw = await backend.callOnce({
      system,
      user: repaired,
      jsonSchema,
      model,
      toolName,
      maxTokens,
    });
    const parsed = schema.safeParse(raw);
    if (parsed.success) return parsed.data;
    if (attempt === 1)
      throw new Error(`Structured output failed validation: ${parsed.error.message}`);
  }
  throw new Error('unreachable');
}
```

**Step 6 — call sites:** replace the Anthropic _client_ with a _backend_ (`createClient` → `createBackend`):

- `src/scoring/score.ts`: change `makeScorer` deps `{ client: Anthropic; … }` → `{ backend: LlmBackend; … }`; change `BatchCall`'s first param `client` → `backend`; in `defaultCall` pass `backend` to `structuredCall`. (Import `LlmBackend` from `../agent/backend.js`; drop the `Anthropic` import.)
- `src/cli.ts` (find + add actions): `makeScorer({ client: createClient(cfg), … })` → `makeScorer({ backend: createBackend(cfg), … })`; import `createBackend` from `./agent/backend.js`. The `--no-score` branch is unchanged (still doesn't construct a backend).
- `src/commands/profile.ts`: `const client = createClient(cfg)` → `const backend = createBackend(cfg)`; every `structuredCall({ client, … })` → `structuredCall({ backend, … })`.
- `src/commands/tailor.ts`: same (`createClient`→`createBackend`; `client`→`backend` in the synth + gap-interview `structuredCall`s).
- `src/mcp/server.ts`: same (`createClient`→`createBackend`; `client`→`backend` in `makeScorer` + the two `structuredCall`s).

**Step 7 — tests (TDD: write/adjust first, watch fail, implement, pass):**

`test/agent/llm.test.ts` — replace the client mock with a backend mock:

```ts
import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { structuredCall } from '../../src/agent/llm.js';

const schema = z.object({ score: z.number() });
const backendOf = (fn: ReturnType<typeof vi.fn>) => ({ callOnce: fn });
const base = { model: 'm', system: 's', user: 'u', toolName: 'emit', schema };

describe('structuredCall', () => {
  it('returns validated raw output from the backend', async () => {
    const out = await structuredCall({
      backend: backendOf(vi.fn().mockResolvedValue({ score: 9 })),
      ...base,
    });
    expect(out).toEqual({ score: 9 });
  });
  it('repairs once on invalid output then succeeds', async () => {
    const callOnce = vi
      .fn()
      .mockResolvedValueOnce({ score: 'NaN' })
      .mockResolvedValueOnce({ score: 7 });
    const out = await structuredCall({ backend: backendOf(callOnce), ...base });
    expect(out).toEqual({ score: 7 });
    expect(callOnce).toHaveBeenCalledTimes(2);
  });
  it('throws after a failed repair', async () => {
    const callOnce = vi.fn().mockResolvedValue({ score: 'x' });
    await expect(structuredCall({ backend: backendOf(callOnce), ...base })).rejects.toThrow(
      /validation/i,
    );
    expect(callOnce).toHaveBeenCalledTimes(2);
  });
  it('passes the json schema + repair hint into callOnce', async () => {
    const callOnce = vi.fn().mockResolvedValue({ score: 1 });
    await structuredCall({ backend: backendOf(callOnce), ...base });
    expect(callOnce.mock.calls[0][0]).toHaveProperty('jsonSchema');
  });
});
```

`test/agent/backends/subscription.test.ts` — mock `run`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { subscriptionBackend, modelAlias } from '../../../src/agent/backends/subscription.js';

const envelope = (o: unknown) => ({
  stdout: JSON.stringify({ is_error: false, structured_output: o }),
  code: 0,
});

describe('subscriptionBackend', () => {
  it('passes -p/--json-schema/--model and returns structured_output', async () => {
    const run = vi.fn().mockResolvedValue(envelope({ score: 5 }));
    const b = subscriptionBackend({ run });
    const out = await b.callOnce({
      system: 'sys',
      user: 'usr',
      jsonSchema: { type: 'object' },
      model: 'claude-opus-4-8',
      toolName: 'emit',
      maxTokens: 1024,
    });
    expect(out).toEqual({ score: 5 });
    const args = run.mock.calls[0][0] as string[];
    expect(args).toContain('-p');
    expect(args[args.indexOf('--model') + 1]).toBe('opus');
    expect(args).toContain('--output-format');
    expect(args).toContain('--json-schema');
    expect(args).toContain('--exclude-dynamic-system-prompt-sections');
  });

  it('throws when the envelope is an error', async () => {
    const run = vi
      .fn()
      .mockResolvedValue({ stdout: JSON.stringify({ is_error: true, result: 'nope' }), code: 0 });
    await expect(
      subscriptionBackend({ run }).callOnce({
        system: '',
        user: '',
        jsonSchema: {},
        model: 'claude-sonnet-4-6',
        toolName: 'x',
        maxTokens: 1,
      }),
    ).rejects.toThrow(/nope/);
  });

  it('throws on non-JSON output', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: 'not json', code: 1 });
    await expect(
      subscriptionBackend({ run }).callOnce({
        system: '',
        user: '',
        jsonSchema: {},
        model: 'claude-sonnet-4-6',
        toolName: 'x',
        maxTokens: 1,
      }),
    ).rejects.toThrow(/non-JSON/);
  });

  it('modelAlias maps full ids to claude aliases', () => {
    expect(modelAlias('claude-opus-4-8')).toBe('opus');
    expect(modelAlias('claude-sonnet-4-6')).toBe('sonnet');
    expect(modelAlias('claude-haiku-4-5')).toBe('haiku');
  });
});
```

`test/agent/backend.test.ts` — selection:

```ts
import { describe, it, expect } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { createBackend } from '../../src/agent/backend.js';

describe('createBackend', () => {
  it('returns a subscription backend by default (no key needed)', () => {
    const cfg = loadConfig('/tmp/x', {});
    expect(typeof createBackend(cfg).callOnce).toBe('function');
  });
  it('throws for the api backend without a key', () => {
    const cfg = loadConfig('/tmp/x', { LAPEL_BACKEND: 'api' });
    expect(() => createBackend(cfg)).toThrow(/ANTHROPIC_API_KEY/);
  });
  it('builds the api backend when a key is present', () => {
    const cfg = loadConfig('/tmp/x', { LAPEL_BACKEND: 'api', ANTHROPIC_API_KEY: 'sk-test' });
    expect(typeof createBackend(cfg).callOnce).toBe('function');
  });
});
```

`test/config.test.ts` — add:

```ts
it('selects the LLM backend (subscription default, api override)', () => {
  expect(loadConfig('/x', {}).backend).toBe('subscription');
  expect(loadConfig('/x', { LAPEL_BACKEND: 'api' }).backend).toBe('api');
});
```

`test/scoring/score.test.ts` — change `client: {} as never` → `backend: {} as never` (the tests inject a `call` mock, so nothing else changes; the mock `call`'s first param is now the backend — unused by the mock).

**Step 8 — verify + commit:**

```
npm test            # all green, no API key (everything mocked at callOnce/run)
npm run lint
npm run typecheck
npm run build
node dist/cli.js find --help   # still works
```

Boundary check still holds (core may not import `@anthropic-ai/sdk`; backends live under `src/agent/`).

```bash
npm run format && git add -A
git commit -m "feat(agent): pluggable LLM backend — subscription (claude CLI) default + api, via LAPEL_BACKEND"
git status --short   # clean
```

---

## Task 21: Docs (README + .env.example)

- `.env.example`: document `LAPEL_BACKEND=subscription|api` (default subscription); clarify `ANTHROPIC_API_KEY` is only needed for `LAPEL_BACKEND=api`.
- `README.md`:
  - Quickstart: by default lapel uses your **Claude Pro/Max subscription via Claude Code** (no API key) — requires the `claude` CLI installed + logged in. To use the API instead: `LAPEL_BACKEND=api` + `ANTHROPIC_API_KEY`.
  - A short "LLM backends" subsection (the pluggable design; the subscription default; honest note on subscription **rate limits** and that envelope `total_cost_usd` is notional, not a charge).
  - MCP config snippet: drop the required `ANTHROPIC_API_KEY` env (not needed for the subscription default); note it's only needed for `LAPEL_BACKEND=api`.
  - "How this was built": add a line that the LLM layer is backend-pluggable (subscription or API) — and that this was a clean swap precisely because of the single `structuredCall` seam.
- Commit: `docs: document LAPEL_BACKEND (subscription default) and the pluggable LLM backend`.

---

## Self-Review (run before handoff)

- [ ] **Spec coverage:** subscription backend via verified `claude` flags ✓; api backend preserved ✓; `LAPEL_BACKEND` selection (subscription default) ✓; structuredCall validate+repair preserved ✓; docs ✓.
- [ ] **Keyless:** `npm test` passes with no `ANTHROPIC_API_KEY` (backends mocked at `callOnce`/`run`). Subscription path needs no key by design.
- [ ] **Boundary intact:** no `@anthropic-ai/sdk` import outside `src/agent/**`; `child_process` only in `backends/subscription.ts`.
- [ ] **Type consistency:** `LlmBackend`/`RawCallRequest`/`StructuredCallArgs.backend` used identically across llm/score/profile/tailor/mcp; `makeScorer` takes `backend`.
- [ ] **No dead client refs:** every former `createClient(cfg)` call site now uses `createBackend(cfg)` (except inside `api.ts`/`createBackend`).

**Exit criteria:** `npm test`/`lint`/`build` green; `LAPEL_BACKEND=subscription` (default) runs with no API key against the `claude` CLI; `LAPEL_BACKEND=api` + key uses the Messages API.

# lapel prep — Design Spec

**Date:** 2026-06-05
**Status:** Approved for implementation planning
**Author:** Design via Claude Opus 4.8 (brainstorming). Intended implementer: Claude Sonnet 4.6 (separate session).

> **Note to implementer:** This spec is written to be self-contained. You will not have the
> brainstorming conversation in context. Every command signature, schema, and module
> responsibility you need is specified here. Where this spec says "exact," treat it as a contract.
> Where it says "implementer's discretion," choose the simplest thing that satisfies the surrounding
> requirements and follow existing patterns in the repo. When in doubt, prefer fewer moving parts.
> Read `CLAUDE.md` first for architecture invariants — this feature must not break any of them.

---

## 1. Problem & Goals

After applying to a role, the user prepares for the interview by pasting the job description and
their résumé into a chat UI and going back and forth with an LLM about how to answer. lapel already
holds both pieces of context (the living profile and the posting), so `prep` brings that workflow
into the pipeline.

**`lapel prep <job-id | --url <url> | --text <file>>`** opens an **interactive coaching
conversation** in the terminal, grounded in the user's profile and the posting, and writes a
study-sheet recap on exit. Prep for a pipeline job **remembers prior sittings** so the user can
prepare across multiple days.

### Goals

1. A live, multi-turn coaching chat (not a one-shot brief) — the thing being replaced is the
   back-and-forth, so back-and-forth is the core.
2. The interview's nature (round type, interviewer, format) is established **conversationally** at
   the start of the session — no rigid `--type` enum.
3. Grounded in the **profile + full posting text** only — the two primary sources, mirroring
   "résumé + JD." No fabrication, same contract as `tailor`.
4. **Resume with memory** for pipeline jobs: re-running `prep <job-id>` continues where the user
   left off.
5. A saved **study-sheet recap** the user can re-read before the interview.

### Non-goals (YAGNI)

- No PDF export (consistent with the tailor spec's non-goal).
- No use of the stored score / matched_skills / missing_skills / tailored application docs as
  context — explicitly deselected during design. Profile + posting only.
- No streaming token output — replies print whole (a consequence of Approach A, §4).
- No MCP `prep` tool in v1 (prep is inherently interactive/stateful; CLI-only for now). May be
  revisited later.

---

## 2. Command Surface

```
lapel prep <job-id>          # a job already in the pipeline
lapel prep --url <url>       # an arbitrary posting URL
lapel prep --text <file>     # posting text from a file
lapel prep ... --opus        # use the synthesis (Opus) tier; default is the worker model
```

- **Exactly one** of `<job-id>` / `--url` / `--text` must be provided. Argument resolution mirrors
  `tailor` (`src/commands/tailor.ts` lines ~35–50): id → `getJobById` (error if absent); url →
  `fetchPostingText`; text → `readFileSync`.
- Requires a profile; error `No profile found. Run \`lapel profile build\` first.`if absent
(same guard as`tailor`/`add`).
- `--opus` selects `cfg.models.synth`; default is `cfg.models.worker` (same convention as
  `tailor --opus`).
- Wired into `src/cli.ts` as a new `program.command('prep')`, thin — delegates to
  `runPrep(cfg, opts)` in `src/commands/prep.ts`.

---

## 3. Context Fed to the Coach

The coach receives only:

- The full **`Profile`** (via `loadProfile`) — source of truth for real experience; no fabrication.
- The full **posting text** — `job.description` (id), fetched text (url), or file contents (text).

For an id, the resolved `company`/`title` come from the job row; for url/text they come from the
posting (model-extracted in the recap step, same fallback approach as `tailor`, with a slug default).

The stored `score`, `matched_skills`, `missing_skills`, `score_reasons`, and any `tailor` output
**must not** be loaded — out of scope by design decision.

---

## 4. Conversation Engine (Approach A: structured turn-loop)

lapel's LLM backend is one-shot and structured-only: every call is
`structuredCall({ system, user, toolName, schema })` → `LlmBackend.callOnce()`. There is no native
chat primitive, and per `CLAUDE.md` **all LLM calls must go through `structuredCall`**. The
conversation is therefore managed in application code and each turn is a single structured call with
the running transcript passed in the prompt. **No backend changes.**

### 4.1 Module: `src/prep/session.ts`

Dependency-injected turn-loop, analogous to `src/tailor/gap-interview.ts`. Pure of I/O and LLM
specifics — everything is injected so it is unit-testable with mocks.

```ts
export type PrepRole = 'coach' | 'candidate';
export interface PrepTurn {
  role: PrepRole;
  text: string;
}

export interface PrepSessionDeps {
  transcript: PrepTurn[]; // seeded from store on resume; [] for new/ephemeral
  respond: (transcript: PrepTurn[]) => Promise<string>; // one structured coach turn → reply text
  ask: (prompt: string) => Promise<string | null>; // readline; null on EOF (Ctrl-D)
  onTurn?: (transcript: PrepTurn[]) => void; // persistence hook, called after every coach turn
}

export interface PrepSessionResult {
  transcript: PrepTurn[];
}

export async function runPrepSession(deps: PrepSessionDeps): Promise<PrepSessionResult>;
```

**Behavior (exact):**

1. **Opening coach turn.** Whether the transcript is empty (new) or seeded (resume), call
   `respond(transcript)` once to produce the first coach message, print it, append it as a `coach`
   turn, and fire `onTurn`. The system prompt (§4.3) instructs the model: if the transcript is empty,
   greet and ask about the round (who, format, focus); if non-empty, welcome the user back and briefly
   recap where they left off before continuing.
2. **Loop.** Call `ask('> ')`:
   - `null` (Ctrl-D) or an exit command (`exit`, `quit`, `/done`, case-insensitive, trimmed) →
     break.
   - Empty/whitespace input → re-prompt without sending a turn.
   - Otherwise append a `candidate` turn, call `respond(transcript)`, print + append the `coach`
     reply, fire `onTurn`.
3. Return the final transcript.

`onTurn` fires after **every** coach turn so a crash or LLM error never loses progress.

### 4.2 Module: `src/agent/prompts/prep.ts`

- `PREP_SYSTEM` — establishes the coach persona: an interview coach grounding strictly in the
  provided profile and posting; **never invents experience**; when the candidate lacks a story,
  helps them find a real one from their background or frame the gap honestly; adapts to the round
  type the candidate describes; offers model answers, follow-ups, and questions-to-ask-them when
  useful; keeps replies focused and conversational. Encodes the opener/resume behavior from §4.1.1.
- `prepTurnUser(profile: Profile, postingText: string, transcript: PrepTurn[]): string` — renders
  the profile, the posting, and the running transcript (labeled COACH/CANDIDATE) into the user
  prompt for the next coach turn.
- `PrepTurnSchema = z.object({ reply: z.string() })` — minimal; the human controls when to stop.

`respond` in the command layer is:
`(transcript) => structuredCall({ backend, model, system: PREP_SYSTEM, user: prepTurnUser(profile, postingText, transcript), toolName: 'emit_coach_turn', schema: PrepTurnSchema, maxTokens: 2048 }).then(r => r.reply)`.

### 4.3 Models

`--opus` → `cfg.models.synth`; default → `cfg.models.worker`.

---

## 5. Persistence & Resume

### 5.1 Schema (`src/db/schema.sql`)

Migrations are `CREATE TABLE IF NOT EXISTS` run on every `migrate()` (no migration code needed —
just add the table):

```sql
CREATE TABLE IF NOT EXISTS prep_sessions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id          INTEGER NOT NULL REFERENCES jobs(id),
  round_context   TEXT,
  transcript_json TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  UNIQUE(job_id)
);
```

`round_context` is reserved for a short human-readable label of the round (implementer's discretion
whether to populate it in v1 — it may stay NULL; the transcript already holds the round discussion).

### 5.2 Store (`src/prep/store.ts`, DB layer — no agent imports)

- `loadPrepSession(db, jobId): PrepTurn[] | null` — parse `transcript_json`, or null if none.
- `savePrepSession(db, jobId, transcript): void` — **upsert on `job_id`** (one rolling session per
  job): insert with `created_at = updated_at = now` if absent, else update `transcript_json` +
  `updated_at`. This is the `onTurn` hook target for id sessions.

Row types (`PrepSessionRow`) live in `src/db/index.ts` alongside `JobRow`/`ApplicationRow`. Keep
`src/prep/store.ts` free of any `src/agent/**` import (lint-enforced for the DB/core layer).

### 5.3 Scope of memory

- **`<job-id>` sessions persist and resume.** They are the only input with a stable key.
- **`--url` / `--text` sessions are ephemeral** — no stable key, so no persistence and no resume.
  Print a one-line note at startup: `(this session won't be remembered — prep a pipeline job by id
to resume later)`. The recap is still written.

---

## 6. Recap Artifact (`src/prep/recap.ts`)

On exit, one structured call generates a study sheet from the full transcript and writes it next to
any tailor output, reusing the `tailor` folder convention `output/<slug(company)>-<slug(title)>/`
(`src/tailor/tailor.ts` line ~49).

- File: `interview-prep.md`, **overwritten** each session (reflects the cumulative rolling
  transcript).
- Prompt `RECAP_SYSTEM` + `recapUserPrompt(transcript)`; schema yields a study sheet with sections:
  **round context · questions practiced + the candidate's draft answers · stories / talking points
  surfaced · gaps to shore up · smart questions to ask them · next steps.** Implementer chooses
  whether to emit one `markdown` string or structured sections rendered to markdown — prefer the
  simpler one that produces those sections.
- Company/title for the folder: for an id, the job row's values; for url/text, model-extracted from
  the recap call (like `tailor`) with a slug fallback (`company`/`role`).
- If the session ended with only the opening coach turn (user typed nothing), skip the LLM recap and
  print a short "nothing to recap yet" note instead of writing a near-empty file.

---

## 7. Command Orchestration (`src/commands/prep.ts`)

`runPrep(cfg, opts)`:

1. Load profile (error if absent). Open db + `migrate`. Create backend.
2. **TTY guard:** if `!process.stdin.isTTY`, throw
   `prep is interactive; run it in a terminal.` (Unlike `tailor`, prep cannot degrade — it has no
   non-interactive mode.)
3. Resolve input → `{ company, title, postingText, jobId? }` (§2/§3).
4. Seed transcript: `jobId != null` → `loadPrepSession(db, jobId) ?? []`; else `[]` (+ print the
   ephemeral note).
5. Build `respond` (§4.2) and a `Prompter` (`createPrompter`, `src/profile/interview.ts`).
6. Run `runPrepSession({ transcript, respond, ask: prompter.ask, onTurn })` where `onTurn` =
   `savePrepSession(db, jobId, t)` for id sessions, a no-op otherwise. Wrap in `try/finally` that
   closes the prompter (mirrors `tailor`).
7. On completion, generate + write the recap (§6) and print the path (mirrors
   `Tailored docs written to ...`).
8. On an LLM error mid-session, surface it but rely on `onTurn` having already persisted progress;
   the next `prep <job-id>` resumes.

> **Prompter note:** `createPrompter().ask` currently returns `Promise<string>`. EOF/Ctrl-D handling
> for the `null` contract in §4.1 is implementer's discretion — either extend the prompter to signal
> EOF or treat readline `close` as an exit. Keep it minimal and consistent with the existing helper.

---

## 8. Error Handling Summary

| Condition                       | Behavior                                                               |
| ------------------------------- | ---------------------------------------------------------------------- |
| No profile                      | Throw the standard "Run `lapel profile build` first."                  |
| Non-TTY stdin                   | Throw "prep is interactive; run it in a terminal."                     |
| Unknown job id                  | Throw `No job with id <n>.` (as `tailor`)                              |
| No input selector               | Throw "Provide a <job-id>, a URL, or --text <file>."                   |
| Empty user input                | Re-prompt; no turn sent                                                |
| LLM call fails mid-session      | Surface error; transcript already persisted via `onTurn` (id sessions) |
| Session with no candidate turns | Skip recap; print "nothing to recap yet"                               |

---

## 9. Testing (vitest; LLM mocked at the `structuredCall`/backend seam — no API key, per `CLAUDE.md`)

- **`session.ts`** — scripted `ask` answers + canned `respond`: asserts opening coach turn is
  produced; transcript role/order is correct; exit commands and EOF end the loop; empty input
  re-prompts without a turn; a seeded (resume) transcript is carried into `respond`; `onTurn` fires
  after every coach turn.
- **`store.ts`** — `save` then `load` round-trips a transcript; second `save` upserts (one row per
  job); sessions for different `job_id`s are isolated.
- **`recap.ts`** — given a transcript + a mocked synth, writes `interview-prep.md` to the expected
  `output/<company>-<title>/` path with the expected sections; the no-candidate-turns case writes
  nothing.
- **`prompts/prep.ts`** — `prepTurnUser` includes the profile, posting, and transcript; a sample
  coach reply validates against `PrepTurnSchema`.
- No network in tests; reuse existing mock patterns.

---

## 10. Files

**New:**

- `src/commands/prep.ts` — CLI orchestration (§7)
- `src/prep/session.ts` — turn-loop engine (§4.1)
- `src/prep/store.ts` — persistence helpers (§5.2)
- `src/prep/recap.ts` — study-sheet generation/writing (§6)
- `src/agent/prompts/prep.ts` — `PREP_SYSTEM`, `prepTurnUser`, `PrepTurnSchema`, recap prompt/schema
- tests for each of the above

**Touched:**

- `src/cli.ts` — register `prep` command
- `src/db/schema.sql` — `prep_sessions` table
- `src/db/index.ts` — `PrepSessionRow` type (and any shared session helpers)
- `docs/BACKLOG.md` — mark prep built / remove from ideas if listed
- `README.md`, `CLAUDE.md` — document the `prep` command in the command list

---

## 11. Architecture Invariants Honored

- **All LLM calls through `structuredCall`** — coach turns and recap are structured calls; no new
  backend method.
- **Deterministic core stays agent-free** — `src/prep/store.ts` and the DB layer import no
  `src/agent/**`; only `src/commands/prep.ts`, `src/prep/recap.ts` (via the injected synth), and
  `src/agent/prompts/prep.ts` touch the LLM.
- **Human-in-the-loop, no auto-chaining** — `prep` is an explicit per-job action, like `tailor`.
- **No fabrication** — `PREP_SYSTEM` grounds strictly in profile + posting and forbids inventing
  experience.

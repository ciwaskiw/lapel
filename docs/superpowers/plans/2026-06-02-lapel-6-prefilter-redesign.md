# lapel — Plan 6: Prefilter Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Read `CLAUDE.md` first (Node 22; NodeNext `.js` imports; deterministic core must not import the LLM layer; tests run with no API key).

**Goal:** Stop the prefilter from over-dropping. It currently substring-matches *fuzzy concepts* (must-haves like "Agile development", dealbreakers like "Relocation") against the full job description as **hard drop-gates**, which (a) drops every job when must-haves are conceptual, and (b) false-positives on negated boilerplate ("no relocation support"). Redesign it to gate **only on reliable title/structured signals**, and move fuzzy fit (skills, culture, dealbreaker nuance) to the LLM scorer.

**Architecture / principle:** *The deterministic prefilter only drops on high-confidence signals it can read reliably — the job **title** (seniority, job family) and the **structured remote flag**. It no longer substring-matches must-haves or dealbreakers against the description.* The LLM scorer becomes the "de-fuzzer": it weighs skills, culture, must-haves, and dealbreakers **in context** and returns a 0–100 score; the user filters with `--min-score`. Conservative throughout: when unsure, **keep** the job.

**Tech Stack:** No new deps. Confined to `src/ingest/prefilter.ts`, the scoring prompt, a couple of tests, and docs.

---

## What changes

| Signal | Before | After |
|---|---|---|
| Missing must-have keyword | **hard drop** (substring on description) | **removed** — must-haves weighed by the scorer |
| Dealbreaker keyword in description | **hard drop** (substring; negation-blind) | **removed** — dealbreakers weighed by the scorer in context |
| Junior/intern title when targeting senior | drop | **keep** (unchanged) |
| Remote-only pref + on-site role (`remote===false`) | drop | **keep** (unchanged) |
| Clearly non-target job family (title) | (none) | **new** — conservative title-based drop |

---

## Task 26: Rewrite the prefilter

**Files:** rewrite `src/ingest/prefilter.ts`; rewrite `test/ingest/prefilter.test.ts`; fix one case in `test/ingest/pipeline.test.ts`.

- [ ] **Step 1 — rewrite `src/ingest/prefilter.ts`:**
```ts
import type { Profile } from '../profile/schema.js';
import type { NormalizedJob } from '../sources/types.js';

export interface Dropped {
  job: NormalizedJob;
  reason: string;
}

const JUNIOR = /\b(intern|internship|junior|jr\.?|entry[- ]level|new grad|graduate)\b/i;

// Title markers of clearly NON-engineering job families (conservative exclusion list).
const OFF_FAMILY =
  /\b(sales|account executive|account manager|marketing|growth marketing|recruit(?:er|ing)|talent acquisition|designer|art director|creative director|brand|copywriter|content strategist|editor|producer|social media|community manager|customer success|support specialist|operations associate|office manager|people partner|accountant|controller|paralegal|legal counsel)\b/i;

// Engineering / technical role terms — a title with any of these is "in family" (keep).
const ROLE_TERMS =
  /\b(engineer|engineering|developer|swe|sde|programmer|architect|full[- ]?stack|back[- ]?end|front[- ]?end|software|platform|infrastructure|devops|sre)\b/i;

const SENIORITY_STOPWORDS = new Set([
  'senior', 'staff', 'principal', 'lead', 'junior', 'mid', 'level', 'the', 'and', 'of', 'for',
]);

function wantsSenior(profile: Profile): boolean {
  return profile.preferences.seniority.some((s) => /senior|staff|principal|lead/i.test(s));
}

// Does the title contain a meaningful word from the candidate's target roles (excluding
// seniority/stop words)? Generalizes role matching beyond the built-in engineering vocab.
function matchesTargetRole(title: string, targetRoles: string[]): boolean {
  const t = title.toLowerCase();
  return targetRoles.some((role) =>
    role
      .toLowerCase()
      .split(/[^a-z]+/)
      .filter((w) => w.length > 3 && !SENIORITY_STOPWORDS.has(w))
      .some((w) => t.includes(w)),
  );
}

export function prefilter(
  jobs: NormalizedJob[],
  profile: Profile,
): { kept: NormalizedJob[]; dropped: Dropped[] } {
  const pref = profile.preferences;
  const kept: NormalizedJob[] = [];
  const dropped: Dropped[] = [];

  for (const job of jobs) {
    const title = job.title;

    // 1. Seniority mismatch (title-based; only when the candidate targets senior+).
    if (wantsSenior(profile) && JUNIOR.test(title)) {
      dropped.push({ job, reason: `seniority mismatch: "${title}"` });
      continue;
    }

    // 2. Remote conflict (structured flag; unambiguous).
    if (pref.remote === 'remote' && job.remote === false) {
      dropped.push({ job, reason: 'remote-only preference but role is on-site' });
      continue;
    }

    // 3. Different job family (conservative): the title clearly names a non-engineering function
    //    AND has no engineering/target-role term. Skills, culture, and dealbreaker nuance are left
    //    to the LLM scorer — the prefilter does NOT substring-match must-haves/dealbreakers.
    if (
      OFF_FAMILY.test(title) &&
      !ROLE_TERMS.test(title) &&
      !matchesTargetRole(title, pref.targetRoles)
    ) {
      dropped.push({ job, reason: `different job family: "${title}"` });
      continue;
    }

    kept.push(job);
  }
  return { kept, dropped };
}
```

- [ ] **Step 2 — rewrite `test/ingest/prefilter.test.ts`** (locks the new behavior):
```ts
import { describe, it, expect } from 'vitest';
import { prefilter } from '../../src/ingest/prefilter.js';
import type { Profile } from '../../src/profile/schema.js';
import type { NormalizedJob } from '../../src/sources/types.js';

const profile = (over: Partial<Profile['preferences']> = {}): Profile => ({
  version: 1, updatedAt: '', basics: { name: '', headline: '', yearsExperience: 8, summary: '' },
  skills: { core: [], familiar: [] }, experience: [], notes: [],
  preferences: {
    targetRoles: ['Senior Full-stack Engineer'], seniority: ['senior', 'staff'], locations: [],
    remote: 'any', maxCommuteMiles: null, minBaseComp: null,
    mustHave: ['TypeScript'], dealbreakers: ['Relocation'], ...over,
  },
});

const j = (over: Partial<NormalizedJob>): NormalizedJob => ({
  source: 'greenhouse', externalId: 'x', company: 'A', title: 'Senior Software Engineer', url: 'u',
  location: 'Remote', remote: true, description: 'We use Go and Kubernetes', postedAt: null, raw: {}, ...over,
});

describe('prefilter', () => {
  it('keeps an engineering role even when must-have keywords are absent (no description gating)', () => {
    const { kept, dropped } = prefilter([j({ description: 'We use Go and Kubernetes' })], profile());
    expect(kept).toHaveLength(1);
    expect(dropped).toHaveLength(0);
  });

  it('does NOT drop on a dealbreaker word appearing (e.g. negated boilerplate)', () => {
    const { kept } = prefilter(
      [j({ description: 'As a remote company we do not offer relocation support.' })],
      profile(),
    );
    expect(kept).toHaveLength(1);
  });

  it('drops a clearly non-engineering title (different job family)', () => {
    const { dropped } = prefilter([j({ title: 'Art Director' })], profile());
    expect(dropped[0].reason).toMatch(/job family/i);
  });

  it('keeps a non-eng-marker title that still has an engineering term', () => {
    const { kept } = prefilter([j({ title: 'Sales Engineer' })], profile()); // "engineer" → in family
    expect(kept).toHaveLength(1);
  });

  it('drops a junior title when targeting senior', () => {
    const { dropped } = prefilter([j({ title: 'Junior Software Engineer' })], profile());
    expect(dropped[0].reason).toMatch(/seniority/i);
  });

  it('drops an on-site role when remote-only is required', () => {
    const { dropped } = prefilter(
      [j({ remote: false, location: 'New York, NY' })],
      profile({ remote: 'remote' }),
    );
    expect(dropped[0].reason).toMatch(/remote/i);
  });

  it('keeps unknown/ambiguous titles (conservative)', () => {
    const { kept } = prefilter([j({ title: 'Senior Data Platform Engineer' })], profile());
    expect(kept).toHaveLength(1);
  });

  it('does not let a shared seniority word ("Senior") rescue a different family', () => {
    const { dropped } = prefilter([j({ title: 'Senior Product Designer' })], profile());
    expect(dropped[0].reason).toMatch(/job family/i);
  });
});
```

- [ ] **Step 3 — fix `test/ingest/pipeline.test.ts`:** the existing "dedups, prefilters, persists…" case drops a job via the old dealbreaker gate (`description: 'PHP only'`, `dealbreakers: ['PHP']`). That gate is gone. Change the dropped job so it's dropped by the NEW prefilter (a different job family). Replace the `j('b', { description: 'PHP only' })` argument with `j('b', { title: 'Marketing Manager' })` and keep the `expect(summary.dropped).toBe(1)` / `expect(summary.added).toBe(1)` assertions. (The `profile` in that test has empty `targetRoles`/`seniority`, so "Marketing Manager" → OFF_FAMILY, no role term, no target-role hit → dropped.)

- [ ] **Step 4 — run + verify:** `npx vitest run test/ingest` → green; then `npm test && npm run lint && npm run typecheck && npm run build` → all green.

- [ ] **Step 5 — commit** (`npm run format` first; stage only `src/ingest/prefilter.ts`, `test/ingest/prefilter.test.ts`, `test/ingest/pipeline.test.ts`):
`feat(ingest): prefilter gates on title/seniority/role-family only; fuzzy fit moves to scoring`

---

## Task 27: Make the scorer the de-fuzzer (weigh must-haves & dealbreakers in context)

**Files:** modify `src/scoring/rubric.ts` (the `RUBRIC` text only — the schema is unchanged).

- [ ] **Step 1 — append to the `RUBRIC` string** (after the existing weighting bullets), so the scorer explicitly judges must-haves/dealbreakers *in context*:
```
Also weigh the candidate's stated must-haves (strong positives) and dealbreakers (strong negatives)
from their profile — but judge them IN CONTEXT, not by keyword presence. For example, a posting that
merely notes "no relocation assistance" is NOT a relocation conflict for a remote candidate; a role
that REQUIRES relocating is. Score a genuine dealbreaker conflict very low (0-20). Treat fuzzy
cultural preferences (e.g. agile process, testing culture, remote flexibility) as soft positives,
not requirements.
```
(The candidate's must-haves/dealbreakers already reach the model — `scoreUserPrompt` renders the full profile, which includes them.)

- [ ] **Step 2 — verify + commit:** `npm test && npm run lint && npm run build` (no test asserts on prompt text, so this is a behavior/quality change). Commit: `feat(scoring): weigh must-haves/dealbreakers in context (the de-fuzzer)`.

> Optional (defer unless quick): lightly adjust `src/agent/prompts/synthesize-profile.ts` so `profile build` keeps `mustHave`/`dealbreakers` as short HARD keywords and routes fuzzy/cultural preferences into `notes`. Not required now that the prefilter no longer gates on those fields — the pollution is harmless to filtering and merely informs scoring. Track as a follow-up.

---

## Task 28: Docs

- [ ] Update the prefilter line in `CLAUDE.md` and the README's "How it works" / scoring blurb to state the new philosophy: *prefilter = title seniority/role-family + remote (deterministic, conservative); the LLM scorer judges skills/culture/dealbreakers in context; filter results with `--min-score`.* Add a one-line note to the design spec (`docs/superpowers/specs/…`) recording the prefilter redesign (keep historical text; add a dated note). Commit: `docs: document the prefilter redesign (gate on title/remote; fuzzy → scoring)`.

---

## Self-Review (before handoff)
- [ ] **Fixes the reported bugs:** the 43-job over-drop (must-have gate removed) and the "relocation" false-positive (dealbreaker description gate removed) — both covered by new prefilter tests.
- [ ] **Conservative:** ambiguous titles are kept; role-family drop requires OFF_FAMILY ∧ ¬ROLE_TERMS ∧ ¬target-role match.
- [ ] **Boundary intact:** `prefilter.ts` imports only types (no agent/LLM).
- [ ] **Keyless tests** still pass; `pipeline.test.ts` updated for the new drop reason.

**Exit criteria:** `npm test`/`lint`/`build` green; a real `lapel find --no-score` against the user's watchlist keeps the engineering roles and drops only clearly-different-family/junior titles (the user verifies).

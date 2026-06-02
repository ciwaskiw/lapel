# lapel — Plan 5: `lapel leads` (messy leads → watchlist + add-list) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. Read `CLAUDE.md` first for repo conventions (Node 22; NodeNext `.js` imports; deterministic core must not import the LLM layer; tests run with no API key).

**Goal:** A `lapel leads <file>` command that turns a messy, human-written job-leads list into the two artifacts lapel needs — `companies.yaml` (an ATS watchlist) and `leads-urls.txt` (direct-add URLs) — so any user can go from notes to scoring/tailoring with one command, no hand-mapping.

**Architecture:** lapel's signature pattern — **agentic extraction + deterministic verification.** An LLM (via the existing `LlmBackend`/`structuredCall` seam) extracts `{company, urls[], notes}` from the messy text; then **pure, network-verified** logic resolves each company to a Greenhouse/Lever/Ashby board (parse known ATS URLs for the slug; otherwise probe the public boards APIs by name-derived slug candidates — the "Rocket Money → greenhouse/truebill" move). Resolvable companies → watchlist; leftover individual posting URLs → add-list; unresolvable career landing pages → flagged. Extraction and probing are injected, so the core is unit-tested with no network/LLM.

**Tech Stack:** Nothing new — reuses `fetchJson` (`src/sources/http.ts`), the `LlmBackend`, `yaml`. NodeNext ESM.

> **Why a command, not a Skill:** slug resolution requires live ATS probes + verification, which a context-only Skill can't do reliably; baking it into the tool means a fresh session needs zero context. (A thin `CLAUDE.md` pointer is enough for agents.)

---

## File Structure (Plan 5)

| File | Responsibility |
|------|----------------|
| `src/leads/extract.ts` | LLM extraction: messy text → `LeadInput[]` (zod), via `structuredCall` |
| `src/leads/resolve.ts` | **pure/deterministic** — `parseAtsUrl`, `slugCandidates`, `probeAts`, `resolveLead` |
| `src/leads/triage.ts` | orchestrates extract + resolve → `{ watchlist, addUrls, unresolved }` (injectable deps) |
| `src/sources/index.ts` | **modify** — add `mergeWatchlist(file, entries)` (read+dedup+write companies.yaml) |
| `src/commands/leads.ts` | `runLeads(cfg, file, opts)` — wires real backend + real probes + file writes |
| `src/cli.ts` | **modify** — register `leads` |
| `test/leads/resolve.test.ts`, `test/leads/triage.test.ts` | unit tests (mock fetch + extractor) |

> `src/leads/resolve.ts` is core-adjacent but lives outside the eslint "core" globs, so it may import `sources/http`. It must NOT import `src/agent`. Only `extract.ts`/`triage.ts`/`commands/leads.ts` touch the LLM.

---

## Task 22: Deterministic resolver (`src/leads/resolve.ts`)

**Files:** Create `src/leads/resolve.ts`, `test/leads/resolve.test.ts`.

- [ ] **Step 1 — write the failing test** `test/leads/resolve.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { parseAtsUrl, slugCandidates, probeAts, resolveLead } from '../../src/leads/resolve.js';

describe('parseAtsUrl', () => {
  it('extracts greenhouse slug from board urls', () => {
    expect(parseAtsUrl('https://job-boards.greenhouse.io/customerio/jobs/7776591')).toEqual({ source: 'greenhouse', slug: 'customerio' });
    expect(parseAtsUrl('https://boards.greenhouse.io/figma/jobs/5759501004?gh_jid=1')).toEqual({ source: 'greenhouse', slug: 'figma' });
  });
  it('extracts lever and ashby slugs', () => {
    expect(parseAtsUrl('https://jobs.lever.co/netflix/abc-123')).toEqual({ source: 'lever', slug: 'netflix' });
    expect(parseAtsUrl('https://jobs.ashbyhq.com/mapbox/uuid-here')).toEqual({ source: 'ashby', slug: 'mapbox' });
  });
  it('returns null for non-ATS urls', () => {
    expect(parseAtsUrl('https://zillow.wd5.myworkdayjobs.com/x/job/y')).toBeNull();
    expect(parseAtsUrl('https://seatgeek.com/jobs/7073875')).toBeNull();
  });
});

describe('slugCandidates', () => {
  it('derives lowercase, punctuation-stripped candidates from a name', () => {
    const c = slugCandidates('Customer.io');
    expect(c).toContain('customerio');
    const d = slugCandidates('Grafana Labs');
    expect(d).toEqual(expect.arrayContaining(['grafanalabs', 'grafana']));
  });
});

describe('probeAts', () => {
  it('returns true when a board has jobs', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ jobs: [{ id: 1 }] }) } as Response);
    expect(await probeAts('greenhouse', 'customerio', fetchImpl as unknown as typeof fetch)).toBe(true);
  });
  it('returns false on 404 / empty', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404 } as Response);
    expect(await probeAts('greenhouse', 'nope', fetchImpl as unknown as typeof fetch)).toBe(false);
  });
});

describe('resolveLead', () => {
  const prober = (hit: Record<string, true>) =>
    async (source: string, slug: string) => Boolean(hit[`${source}:${slug}`]);

  it('uses a known ATS url → watchlist (drops the redundant url)', async () => {
    const r = await resolveLead({ company: 'Customer.io', urls: ['https://job-boards.greenhouse.io/customerio/jobs/1'], notes: '' }, { probe: prober({}) });
    expect(r.watchlist).toEqual({ source: 'greenhouse', slug: 'customerio', name: 'Customer.io' });
    expect(r.addUrls).toEqual([]);
  });
  it('probes by name when no ATS url is given → watchlist', async () => {
    const r = await resolveLead({ company: 'Grafana Labs', urls: [], notes: '' }, { probe: prober({ 'greenhouse:grafanalabs': true }) });
    expect(r.watchlist).toEqual({ source: 'greenhouse', slug: 'grafanalabs', name: 'Grafana Labs' });
  });
  it('keeps non-ATS posting urls as add-urls', async () => {
    const r = await resolveLead({ company: 'SeatGeek', urls: ['https://seatgeek.com/jobs/7073875'], notes: '' }, { probe: prober({}) });
    expect(r.watchlist).toBeUndefined();
    expect(r.addUrls).toEqual(['https://seatgeek.com/jobs/7073875']);
  });
  it('flags a company with no urls and no probe hit as unresolved', async () => {
    const r = await resolveLead({ company: 'Geico', urls: [], notes: 'careers page' }, { probe: prober({}) });
    expect(r.unresolved).toMatch(/Geico/);
  });
});
```

- [ ] **Step 2 — implement `src/leads/resolve.ts`:**
```ts
import { fetchJson } from '../sources/http.js';
import type { WatchlistEntry } from '../sources/types.js';

export type AtsSource = WatchlistEntry['source']; // 'greenhouse' | 'lever' | 'ashby'

export interface LeadInput {
  company: string;
  urls: string[];
  notes: string;
}

export interface ResolvedLead {
  watchlist?: WatchlistEntry;
  addUrls: string[];
  unresolved?: string;
}

export function parseAtsUrl(url: string): { source: AtsSource; slug: string } | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname;
  const parts = u.pathname.split('/').filter(Boolean);
  if (host.endsWith('greenhouse.io')) {
    // job-boards/boards: /<slug>/jobs/...   boards-api: /v1/boards/<slug>/jobs
    const slug = parts[0] === 'v1' && parts[1] === 'boards' ? parts[2] : parts[0];
    return slug ? { source: 'greenhouse', slug } : null;
  }
  if (host.endsWith('lever.co')) {
    const slug = parts[0] === 'v0' && parts[1] === 'postings' ? parts[2] : parts[0];
    return slug ? { source: 'lever', slug } : null;
  }
  if (host.endsWith('ashbyhq.com')) {
    // jobs.ashbyhq.com/<slug>/...   api...: /posting-api/job-board/<slug>
    const slug = parts[0] === 'posting-api' ? parts[2] : parts[0];
    return slug ? { source: 'ashby', slug } : null;
  }
  return null;
}

export function slugCandidates(name: string): string[] {
  const base = name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '');
  const firstWord = name.toLowerCase().replace(/[^a-z0-9 ]+/g, '').split(/\s+/)[0];
  return [...new Set([base, firstWord].filter(Boolean))];
}

const PROBE_URL: Record<AtsSource, (slug: string) => string> = {
  greenhouse: (s) => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs`,
  lever: (s) => `https://api.lever.co/v0/postings/${s}?mode=json`,
  ashby: (s) => `https://api.ashbyhq.com/posting-api/job-board/${s}`,
};

export async function probeAts(source: AtsSource, slug: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const data = await fetchJson<unknown>(PROBE_URL[source](slug), { retries: 1, fetchImpl });
    const jobs = source === 'lever' ? (data as unknown[]) : (data as { jobs?: unknown[] }).jobs;
    return Array.isArray(jobs) && jobs.length > 0;
  } catch {
    return false;
  }
}

export interface ResolveDeps {
  probe?: (source: AtsSource, slug: string) => Promise<boolean>;
}

export async function resolveLead(lead: LeadInput, deps: ResolveDeps = {}): Promise<ResolvedLead> {
  const probe = deps.probe ?? ((s: AtsSource, slug: string) => probeAts(s, slug));

  // 1. A known ATS url in the lead pins the board directly.
  for (const url of lead.urls) {
    const ats = parseAtsUrl(url);
    if (ats) return { watchlist: { ...ats, name: lead.company }, addUrls: [] };
  }
  // 2. No ATS url — probe by name-derived candidates across the three boards.
  for (const slug of slugCandidates(lead.company)) {
    for (const source of ['greenhouse', 'lever', 'ashby'] as AtsSource[]) {
      if (await probe(source, slug)) return { watchlist: { source, slug, name: lead.company }, addUrls: [] };
    }
  }
  // 3. Not resolvable to a board. Non-ATS posting urls become direct adds.
  if (lead.urls.length > 0) return { addUrls: lead.urls };
  return { addUrls: [], unresolved: `${lead.company} — no ATS board found and no posting URL (careers landing page?)` };
}
```

- [ ] **Step 3** — run `npx vitest run test/leads/resolve.test.ts` → PASS; commit `feat(leads): deterministic ATS resolver (parse/probe/resolve)`.

---

## Task 23: LLM extraction + triage orchestration

**Files:** Create `src/leads/extract.ts`, `src/leads/triage.ts`, `test/leads/triage.test.ts`.

- [ ] **Step 1 — `src/leads/extract.ts`** (LLM via the existing seam):
```ts
import { z } from 'zod';
import type { LlmBackend } from '../agent/backend.js';
import { structuredCall } from '../agent/llm.js';
import type { LeadInput } from './resolve.js';

export const LeadsSchema = z.object({
  leads: z.array(z.object({ company: z.string(), urls: z.array(z.string()), notes: z.string() })),
});

export const EXTRACT_SYSTEM = `You extract job leads from a messy, free-form notes file. Return one
entry per distinct COMPANY (merge multiple roles/links for the same company into that company's
\`urls\` list). Include every explicit posting URL you see, cleaned of tracking query params. Put any
useful free-text (referrals, location/commute notes, "interested") into \`notes\`. Do not invent URLs
or companies.`;

export function extractLeads(backend: LlmBackend, model: string, text: string): Promise<{ leads: LeadInput[] }> {
  return structuredCall({
    backend, model,
    system: EXTRACT_SYSTEM,
    user: `LEADS FILE:\n${text.slice(0, 20000)}`,
    toolName: 'emit_leads',
    schema: LeadsSchema,
    maxTokens: 4096,
  });
}
```

- [ ] **Step 2 — `src/leads/triage.ts`:**
```ts
import type { WatchlistEntry } from '../sources/types.js';
import { resolveLead, type LeadInput, type ResolveDeps } from './resolve.js';

export interface TriageResult {
  watchlist: WatchlistEntry[];
  addUrls: string[];
  unresolved: string[];
}

export interface TriageDeps extends ResolveDeps {
  extract: (text: string) => Promise<{ leads: LeadInput[] }>;
}

export async function triageLeads(text: string, deps: TriageDeps): Promise<TriageResult> {
  const { leads } = await deps.extract(text);
  const seen = new Set<string>();
  const out: TriageResult = { watchlist: [], addUrls: [], unresolved: [] };
  for (const lead of leads) {
    const r = await resolveLead(lead, { probe: deps.probe });
    if (r.watchlist) {
      const key = `${r.watchlist.source}:${r.watchlist.slug}`;
      if (!seen.has(key)) { seen.add(key); out.watchlist.push(r.watchlist); }
    }
    for (const u of r.addUrls) if (!out.addUrls.includes(u)) out.addUrls.push(u);
    if (r.unresolved) out.unresolved.push(r.unresolved);
  }
  return out;
}
```

- [ ] **Step 3 — `test/leads/triage.test.ts`** (inject `extract` + `probe`, no LLM/network):
```ts
import { describe, it, expect, vi } from 'vitest';
import { triageLeads } from '../../src/leads/triage.js';

describe('triageLeads', () => {
  it('splits leads into watchlist, add-urls, and unresolved (deduped)', async () => {
    const extract = vi.fn().mockResolvedValue({
      leads: [
        { company: 'Customer.io', urls: ['https://job-boards.greenhouse.io/customerio/jobs/1'], notes: '' },
        { company: 'SeatGeek', urls: ['https://seatgeek.com/jobs/7073875'], notes: '' },
        { company: 'Grafana', urls: [], notes: '' },
        { company: 'Geico', urls: [], notes: 'careers page' },
        { company: 'Customer.io', urls: ['https://job-boards.greenhouse.io/customerio/jobs/2'], notes: '' },
      ],
    });
    const probe = async (s: string, slug: string) => s === 'greenhouse' && slug === 'grafana';
    const r = await triageLeads('…', { extract, probe });
    expect(r.watchlist).toEqual([
      { source: 'greenhouse', slug: 'customerio', name: 'Customer.io' },
      { source: 'greenhouse', slug: 'grafana', name: 'Grafana' },
    ]);
    expect(r.addUrls).toEqual(['https://seatgeek.com/jobs/7073875']);
    expect(r.unresolved[0]).toMatch(/Geico/);
  });
});
```

- [ ] **Step 4** — run `npx vitest run test/leads` → PASS; commit `feat(leads): LLM extraction + triage orchestration`.

---

## Task 24: `mergeWatchlist` + the `leads` command + CLI wiring

**Files:** Modify `src/sources/index.ts`, `src/cli.ts`; create `src/commands/leads.ts`. (Optional: a small test for `mergeWatchlist` against a temp file.)

- [ ] **Step 1 — `src/sources/index.ts`: add `mergeWatchlist`:**
```ts
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parse, stringify } from 'yaml';
// (keep existing imports/exports)

export function mergeWatchlist(file: string, entries: WatchlistEntry[]): { added: number } {
  const existing = existsSync(file) ? loadWatchlist(file) : [];
  const seen = new Set(existing.map((e) => `${e.source}:${e.slug}`));
  let added = 0;
  for (const e of entries) {
    const key = `${e.source}:${e.slug}`;
    if (!seen.has(key)) { seen.add(key); existing.push(e); added++; }
  }
  writeFileSync(file, stringify({ companies: existing }));
  return { added };
}
```

- [ ] **Step 2 — `src/commands/leads.ts`:**
```ts
import { readFileSync, appendFileSync, existsSync, readFileSync as rf } from 'node:fs';
import type { Config } from '../config.js';
import { createBackend } from '../agent/backend.js';
import { extractLeads } from '../leads/extract.js';
import { triageLeads } from '../leads/triage.js';
import { mergeWatchlist } from '../sources/index.js';

export async function runLeads(cfg: Config, file: string, opts: { dryRun?: boolean }): Promise<void> {
  const text = readFileSync(file, 'utf8');
  const backend = createBackend(cfg);
  const result = await triageLeads(text, { extract: (t) => extractLeads(backend, cfg.models.worker, t) });

  console.log(`\nWatchlist (${result.watchlist.length}) → ${cfg.companiesFile}`);
  for (const e of result.watchlist) console.log(`  ${e.source}/${e.slug}  (${e.name})`);
  console.log(`\nDirect-add URLs (${result.addUrls.length})`);
  for (const u of result.addUrls) console.log(`  ${u}`);
  if (result.unresolved.length) {
    console.log(`\nUnresolved (needs a posting URL or manual ATS lookup):`);
    for (const u of result.unresolved) console.log(`  - ${u}`);
  }
  if (opts.dryRun) { console.log('\n(--dry-run: nothing written)'); return; }

  const { added } = mergeWatchlist(cfg.companiesFile, result.watchlist);
  const addsFile = 'leads-urls.txt';
  const have = existsSync(addsFile) ? new Set(rf(addsFile, 'utf8').split('\n').map((s) => s.trim())) : new Set<string>();
  const fresh = result.addUrls.filter((u) => !have.has(u));
  if (fresh.length) appendFileSync(addsFile, (existsSync(addsFile) ? '' : '') + fresh.join('\n') + '\n');
  console.log(`\nWrote: +${added} watchlist companies, +${fresh.length} add-urls (${addsFile}).`);
}
```

- [ ] **Step 3 — register in `src/cli.ts`:**
```ts
import { runLeads } from './commands/leads.js';

program
  .command('leads')
  .description('Triage a messy leads file into companies.yaml (watchlist) + leads-urls.txt.')
  .argument('<file>', 'a markdown/text file of job leads')
  .option('--dry-run', 'print the plan without writing files')
  .action(async (file: string, opts) => {
    await runLeads(loadConfig(), file, { dryRun: opts.dryRun });
  });
```

- [ ] **Step 4** — `npm run build && node dist/cli.js leads --help`; `npm test && npm run lint && npm run typecheck && npm run build`; `npm run format`; commit `feat(leads): lapel leads command + companies.yaml merge`.

---

## Task 25: Docs

- [ ] README: a "Triage your leads" subsection near Quickstart — `lapel leads leads.md` produces `companies.yaml` + `leads-urls.txt`; mention it resolves ATS boards automatically (incl. renamed companies it can find by probing), and flags careers landing pages it can't resolve. Add `leads` to the command table. Add a "How this was built" nod (agentic extraction + deterministic ATS verification). Commit `docs: document lapel leads`.

---

## Self-Review (before handoff)
- [ ] **Boundary:** `resolve.ts` imports only `sources/http` + types (no `agent`); only `extract/triage/commands` touch the LLM.
- [ ] **Keyless tests:** all new tests inject `extract`/`probe` — no network, no API key.
- [ ] **Honest limits:** renamed companies whose slug ≠ name (e.g. Rocket Money→`truebill`) won't be found by name-probing — they surface in `unresolved`; the user adds them by hand or via a known posting URL. README should say so.
- [ ] **Dedup:** watchlist dedups by `source:slug`; add-urls dedup; `mergeWatchlist` doesn't duplicate existing entries.

**Exit criteria:** `lapel leads <file>` writes a correct `companies.yaml` + `leads-urls.txt` from a messy file (verify once on the real leads list with `--dry-run`); full suite/lint/build green.

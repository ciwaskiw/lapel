import { fetchJson } from '../sources/http.js';
import type { WatchlistEntry } from '../sources/types.js';

export type AtsSource = WatchlistEntry['source'];

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
    const slug = parts[0] === 'v1' && parts[1] === 'boards' ? parts[2] : parts[0];
    return slug ? { source: 'greenhouse', slug } : null;
  }
  if (host.endsWith('lever.co')) {
    const slug = parts[0] === 'v0' && parts[1] === 'postings' ? parts[2] : parts[0];
    return slug ? { source: 'lever', slug } : null;
  }
  if (host.endsWith('ashbyhq.com')) {
    const slug = parts[0] === 'posting-api' ? parts[2] : parts[0];
    return slug ? { source: 'ashby', slug } : null;
  }
  return null;
}

export function slugCandidates(name: string): string[] {
  const base = name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '');
  const firstWord = name
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, '')
    .split(/\s+/)[0];
  return [...new Set([base, firstWord].filter(Boolean))];
}

const PROBE_URL: Record<AtsSource, (slug: string) => string> = {
  greenhouse: (s) => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs`,
  lever: (s) => `https://api.lever.co/v0/postings/${s}?mode=json`,
  ashby: (s) => `https://api.ashbyhq.com/posting-api/job-board/${s}`,
};

export async function probeAts(
  source: AtsSource,
  slug: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
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

  for (const url of lead.urls) {
    const ats = parseAtsUrl(url);
    if (ats) return { watchlist: { ...ats, name: lead.company }, addUrls: [] };
  }
  for (const slug of slugCandidates(lead.company)) {
    for (const source of ['greenhouse', 'lever', 'ashby'] as AtsSource[]) {
      if (await probe(source, slug))
        return { watchlist: { source, slug, name: lead.company }, addUrls: [] };
    }
  }
  if (lead.urls.length > 0) return { addUrls: lead.urls };
  return {
    addUrls: [],
    unresolved: `${lead.company} — no ATS board found and no posting URL (careers landing page?)`,
  };
}

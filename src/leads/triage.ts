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
      if (!seen.has(key)) {
        seen.add(key);
        out.watchlist.push(r.watchlist);
      }
    }
    for (const u of r.addUrls) if (!out.addUrls.includes(u)) out.addUrls.push(u);
    if (r.unresolved) out.unresolved.push(r.unresolved);
  }
  return out;
}

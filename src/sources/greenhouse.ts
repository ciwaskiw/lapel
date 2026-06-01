import { fetchJson, stripHtml } from './http.js';
import type { NormalizedJob, SourceAdapter, WatchlistEntry } from './types.js';

interface GhJob {
  id: number;
  title: string;
  absolute_url: string;
  location?: { name?: string };
  content?: string;
  updated_at?: string;
}

function isRemote(loc: string | null): boolean | null {
  if (!loc) return null;
  return /remote/i.test(loc) ? true : null;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

export const greenhouse: SourceAdapter & {
  fetchJobs(entry: WatchlistEntry, fetchImpl?: typeof fetch): Promise<NormalizedJob[]>;
} = {
  source: 'greenhouse',
  async fetchJobs(entry: WatchlistEntry, fetchImpl: typeof fetch = fetch) {
    const url = `https://boards-api.greenhouse.io/v1/boards/${entry.slug}/jobs?content=true`;
    const data = await fetchJson<{ jobs: GhJob[] }>(url, {
      init: { headers: { accept: 'application/json' } },
      fetchImpl,
    });
    return (data.jobs ?? []).map((j) => {
      const location = j.location?.name ?? null;
      return {
        source: 'greenhouse',
        externalId: String(j.id),
        company: entry.name ?? entry.slug,
        title: j.title,
        url: j.absolute_url,
        location,
        remote: isRemote(location),
        description: stripHtml(decodeEntities(j.content ?? '')),
        postedAt: j.updated_at ?? null,
        raw: j,
      };
    });
  },
};

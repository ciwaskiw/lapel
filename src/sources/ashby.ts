import { fetchJson, stripHtml } from './http.js';
import type { NormalizedJob, SourceAdapter, WatchlistEntry } from './types.js';

interface AshbyJob {
  id: string;
  title: string;
  location?: string;
  isRemote?: boolean;
  jobUrl?: string;
  applyUrl?: string;
  descriptionHtml?: string;
  descriptionPlain?: string;
  publishedAt?: string;
}

export const ashby: SourceAdapter & {
  fetchJobs(entry: WatchlistEntry, fetchImpl?: typeof fetch): Promise<NormalizedJob[]>;
} = {
  source: 'ashby',
  async fetchJobs(entry: WatchlistEntry, fetchImpl: typeof fetch = fetch) {
    // Ashby's public posting API is a GET (a POST returns 401).
    const url = `https://api.ashbyhq.com/posting-api/job-board/${entry.slug}`;
    const data = await fetchJson<{ jobs: AshbyJob[] }>(url, {
      init: { headers: { accept: 'application/json' } },
      fetchImpl,
    });
    return (data.jobs ?? []).map((j) => ({
      source: 'ashby',
      externalId: j.id,
      company: entry.name ?? entry.slug,
      title: j.title,
      url: j.jobUrl ?? j.applyUrl ?? '',
      location: j.location ?? null,
      remote: j.isRemote ?? (j.location ? /remote/i.test(j.location) : null),
      description: j.descriptionPlain ?? stripHtml(j.descriptionHtml ?? ''),
      postedAt: j.publishedAt ?? null,
      raw: j,
    }));
  },
};

import { fetchJson, stripHtml } from './http.js';
import type { NormalizedJob, SourceAdapter, WatchlistEntry } from './types.js';

interface LeverPosting {
  id: string;
  text: string;
  hostedUrl: string;
  categories?: { location?: string; commitment?: string };
  descriptionPlain?: string;
  description?: string;
  createdAt?: number;
}

export const lever: SourceAdapter & {
  fetchJobs(entry: WatchlistEntry, fetchImpl?: typeof fetch): Promise<NormalizedJob[]>;
} = {
  source: 'lever',
  async fetchJobs(entry: WatchlistEntry, fetchImpl: typeof fetch = fetch) {
    const url = `https://api.lever.co/v0/postings/${entry.slug}?mode=json`;
    const data = await fetchJson<LeverPosting[]>(url, { fetchImpl });
    return (data ?? []).map((p) => {
      const location = p.categories?.location ?? null;
      return {
        source: 'lever',
        externalId: p.id,
        company: entry.name ?? entry.slug,
        title: p.text,
        url: p.hostedUrl,
        location,
        remote: location ? /remote/i.test(location) : null,
        description: p.descriptionPlain ?? stripHtml(p.description ?? ''),
        postedAt: p.createdAt ? new Date(p.createdAt).toISOString() : null,
        raw: p,
      };
    });
  },
};

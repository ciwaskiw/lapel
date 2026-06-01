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
    company:
      posting.company ??
      (() => {
        try {
          return new URL(url).hostname;
        } catch {
          return url;
        }
      })(),
    title: posting.title ?? 'Untitled posting',
    url,
    location: null,
    remote: null,
    description: posting.text,
    postedAt: null,
    raw: { url, fetchedAt: new Date().toISOString() },
  };
}

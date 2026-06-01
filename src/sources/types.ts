export type SourceName = 'greenhouse' | 'lever' | 'ashby' | 'url';

export interface NormalizedJob {
  source: SourceName;
  externalId: string;
  company: string;
  title: string;
  url: string;
  location: string | null;
  remote: boolean | null;
  description: string;
  postedAt: string | null;
  raw: unknown;
}

export interface WatchlistEntry {
  source: Exclude<SourceName, 'url'>;
  slug: string;
  name?: string;
}

export interface SourceAdapter {
  source: Exclude<SourceName, 'url'>;
  fetchJobs(entry: WatchlistEntry): Promise<NormalizedJob[]>;
}

import type Database from 'better-sqlite3';
import { existingKeys } from '../db/index.js';
import type { NormalizedJob } from '../sources/types.js';

export function dedup(
  db: Database.Database,
  jobs: NormalizedJob[],
): { fresh: NormalizedJob[]; duplicates: NormalizedJob[] } {
  const { ids, urls } = existingKeys(db);
  const seenKey = new Set<string>();
  const seenUrl = new Set<string>();
  const fresh: NormalizedJob[] = [];
  const duplicates: NormalizedJob[] = [];
  for (const job of jobs) {
    const key = `${job.source}:${job.externalId}`;
    if (ids.has(key) || urls.has(job.url) || seenKey.has(key) || seenUrl.has(job.url)) {
      duplicates.push(job);
    } else {
      fresh.push(job);
      seenKey.add(key);
      seenUrl.add(job.url);
    }
  }
  return { fresh, duplicates };
}

import type Database from 'better-sqlite3';
import { upsertJob, type JobScoreFields } from '../db/index.js';
import type { Profile } from '../profile/schema.js';
import type { NormalizedJob } from '../sources/types.js';
import { dedup } from './dedup.js';
import { prefilter, type Dropped } from './prefilter.js';

export type Scorer = (
  jobs: NormalizedJob[],
  profile: Profile,
) => Promise<Map<string, JobScoreFields>>;

export interface IngestSummary {
  fetched: number;
  duplicates: number;
  dropped: number;
  droppedDetail: Dropped[];
  added: number;
  updated: number;
}

export async function ingest(
  db: Database.Database,
  jobs: NormalizedJob[],
  profile: Profile,
  opts: { score: Scorer | null },
): Promise<IngestSummary> {
  const { fresh, duplicates } = dedup(db, jobs);
  const { kept, dropped } = prefilter(fresh, profile);

  const scores = opts.score ? await opts.score(kept, profile) : new Map<string, JobScoreFields>();

  let added = 0;
  let updated = 0;
  for (const job of kept) {
    const r = upsertJob(db, job, scores.get(`${job.source}:${job.externalId}`));
    if (r.inserted) added++;
    else updated++;
  }
  return {
    fetched: jobs.length,
    duplicates: duplicates.length,
    dropped: dropped.length,
    droppedDetail: dropped,
    added,
    updated,
  };
}

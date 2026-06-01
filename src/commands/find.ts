import type Database from 'better-sqlite3';
import { adapters } from '../sources/index.js';
import type { NormalizedJob, WatchlistEntry } from '../sources/types.js';
import type { Profile } from '../profile/schema.js';
import { ingest, type IngestSummary, type Scorer } from '../ingest/pipeline.js';
import { formatTable } from '../ui/table.js';
import { getJobs } from '../db/index.js';

export interface RunFindDeps {
  db: Database.Database;
  profile: Profile;
  watchlist: WatchlistEntry[];
  score: Scorer | null;
  keepDropped?: boolean;
  limit?: number;
  minScore?: number;
  fetchEntry?: (entry: WatchlistEntry) => Promise<NormalizedJob[]>;
  log?: (msg: string) => void;
}

export async function runFind(deps: RunFindDeps): Promise<IngestSummary> {
  const log = deps.log ?? ((m: string) => console.log(m));
  const fetchEntry = deps.fetchEntry ?? ((e: WatchlistEntry) => adapters[e.source].fetchJobs(e));

  const all: NormalizedJob[] = [];
  for (const entry of deps.watchlist) {
    try {
      const jobs = await fetchEntry(entry);
      all.push(...jobs);
    } catch (err) {
      console.error(`  ! ${entry.source}:${entry.slug} failed: ${(err as Error).message}`);
    }
  }

  const summary = await ingest(deps.db, all, deps.profile, { score: deps.score });

  if (summary.dropped > 0) {
    console.error(`Prefilter dropped ${summary.dropped} job(s):`);
    for (const d of summary.droppedDetail) console.error(`  - ${d.job.title} @ ${d.job.company}: ${d.reason}`);
  }
  if (deps.keepDropped) {
    log('\nDropped (not persisted):');
    log(formatTable(['Title', 'Company', 'Reason'], summary.droppedDetail.map((d) => [d.job.title, d.job.company, d.reason])));
  }

  const rows = getJobs(deps.db, { minScore: deps.minScore, limit: deps.limit });
  log(`\nFetched ${summary.fetched}, added ${summary.added}, updated ${summary.updated}, dropped ${summary.dropped}.`);
  log(formatTable(
    ['ID', 'Score', 'Status', 'Title', 'Company', 'Location'],
    rows.map((r) => [String(r.id), r.score == null ? '—' : String(r.score), r.status, r.title, r.company, r.location ?? '']),
  ));
  return summary;
}

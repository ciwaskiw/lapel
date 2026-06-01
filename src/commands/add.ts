import type Database from 'better-sqlite3';
import { fetchPostingText, urlToNormalizedJob, type PostingText } from '../fetcher/posting.js';
import { ingest, type IngestSummary, type Scorer } from '../ingest/pipeline.js';
import { getJobs } from '../db/index.js';
import { formatTable } from '../ui/table.js';
import type { NormalizedJob } from '../sources/types.js';
import type { Profile } from '../profile/schema.js';

export interface RunAddDeps {
  db: Database.Database;
  profile: Profile;
  urls: string[];
  score: Scorer | null;
  keepDropped?: boolean;
  fetchPosting?: (url: string) => Promise<PostingText>;
  log?: (msg: string) => void;
}

export async function runAdd(deps: RunAddDeps): Promise<IngestSummary> {
  const log = deps.log ?? ((m: string) => console.log(m));
  const fetchPosting = deps.fetchPosting ?? ((u: string) => fetchPostingText(u));
  const jobs: NormalizedJob[] = [];
  for (const url of deps.urls) {
    try {
      jobs.push(urlToNormalizedJob(url, await fetchPosting(url)));
    } catch (err) {
      console.error(`  ! ${url} failed: ${(err as Error).message}`);
    }
  }
  const summary = await ingest(deps.db, jobs, deps.profile, { score: deps.score });
  if (summary.dropped > 0) {
    console.error(`Prefilter dropped ${summary.dropped} job(s):`);
    for (const d of summary.droppedDetail) console.error(`  - ${d.job.title}: ${d.reason}`);
  }
  if (deps.keepDropped)
    log(formatTable(['Title', 'Reason'], summary.droppedDetail.map((d) => [d.job.title, d.reason])));
  const rows = getJobs(deps.db, {});
  log(`\nAdded ${summary.added}, updated ${summary.updated}, dropped ${summary.dropped}.`);
  log(formatTable(['ID', 'Score', 'Title', 'Company'], rows.map((r) => [String(r.id), r.score == null ? '—' : String(r.score), r.title, r.company])));
  return summary;
}

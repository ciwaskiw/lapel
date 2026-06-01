#!/usr/bin/env node
import { Command } from 'commander';
import { loadConfig } from './config.js';
import { openDb, migrate } from './db/index.js';
import { loadProfile } from './profile/store.js';
import { loadWatchlist } from './sources/index.js';
import { runFind } from './commands/find.js';
import { renderPipeline, changeStatus } from './commands/pipeline.js';
import type { JobStatus } from './db/index.js';
import { createClient } from './agent/client.js';
import { makeScorer } from './scoring/score.js';

const program = new Command();
program
  .name('job-scout')
  .description('Find and tailor job applications from your living profile.')
  .version('0.1.0');

program
  .command('find')
  .description('Crawl the ATS watchlist, normalize, dedup, prefilter, persist, and rank.')
  .option('--limit <n>', 'max rows to display', (v) => parseInt(v, 10))
  .option('--min-score <n>', 'minimum score to display', (v) => parseInt(v, 10))
  .option('--no-score', 'skip LLM scoring (prefilter only)')
  .option('--keep-dropped', 'also print prefilter-dropped jobs')
  .action(async (opts) => {
    const cfg = loadConfig();
    const profile = loadProfile(cfg);
    if (!profile) throw new Error('No profile found. Run `job-scout profile build` first.');
    const db = openDb(cfg.dbPath);
    migrate(db);
    const watchlist = loadWatchlist(cfg.companiesFile);
    const score =
      opts.score === false
        ? null
        : makeScorer({ client: createClient(cfg), model: cfg.models.worker, batchSize: cfg.scoringBatchSize });
    await runFind({ db, profile, watchlist, score, keepDropped: opts.keepDropped, limit: opts.limit, minScore: opts.minScore });
  });

program
  .command('pipeline')
  .description('View tracked jobs.')
  .option('--status <status>', 'filter by status')
  .option('--min-score <n>', 'minimum score', (v) => parseInt(v, 10))
  .action((opts) => {
    const cfg = loadConfig();
    const db = openDb(cfg.dbPath);
    migrate(db);
    console.log(renderPipeline(db, { status: opts.status as JobStatus | undefined, minScore: opts.minScore }));
  });

program
  .command('status')
  .description('Advance a job between new | interested | applied | rejected.')
  .argument('<job-id>', 'job id', (v) => parseInt(v, 10))
  .argument('<state>', 'new | interested | applied | rejected')
  .action((jobId: number, state: string) => {
    const cfg = loadConfig();
    const db = openDb(cfg.dbPath);
    migrate(db);
    changeStatus(db, jobId, state as JobStatus);
    console.log(`Job ${jobId} → ${state}`);
  });

program.parseAsync(process.argv).catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(process.env.JOB_SCOUT_DEBUG === '1' ? err : `Error: ${message}`);
  process.exit(1);
});

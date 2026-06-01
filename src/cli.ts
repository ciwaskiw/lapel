#!/usr/bin/env node
import { Command } from 'commander';
import { loadConfig } from './config.js';
import { openDb, migrate } from './db/index.js';
import { loadProfile } from './profile/store.js';
import { loadWatchlist } from './sources/index.js';
import { runFind } from './commands/find.js';

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
    await runFind({ db, profile, watchlist, score: null, keepDropped: opts.keepDropped, limit: opts.limit, minScore: opts.minScore });
  });

program.parseAsync(process.argv).catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(process.env.JOB_SCOUT_DEBUG === '1' ? err : `Error: ${message}`);
  process.exit(1);
});

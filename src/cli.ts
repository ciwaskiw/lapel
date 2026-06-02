#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import { loadConfig } from './config.js';
import { openDb, migrate } from './db/index.js';
import { loadProfile } from './profile/store.js';
import { loadWatchlist } from './sources/index.js';
import { runFind } from './commands/find.js';
import { renderPipeline, changeStatus } from './commands/pipeline.js';
import type { JobStatus } from './db/index.js';
import { createBackend } from './agent/backend.js';
import { makeScorer } from './scoring/score.js';
import { runProfileBuild, runProfileUpdate, runProfileShow } from './commands/profile.js';
import { runAdd } from './commands/add.js';
import { runTailor } from './commands/tailor.js';
import { startMcpServer } from './mcp/server.js';
import { runLeads } from './commands/leads.js';

const program = new Command();
program
  .name('lapel')
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
    if (!profile) throw new Error('No profile found. Run `lapel profile build` first.');
    const db = openDb(cfg.dbPath);
    migrate(db);
    const watchlist = loadWatchlist(cfg.companiesFile);
    const score =
      opts.score === false
        ? null
        : makeScorer({
            backend: createBackend(cfg),
            model: cfg.models.worker,
            batchSize: cfg.scoringBatchSize,
          });
    await runFind({
      db,
      profile,
      watchlist,
      score,
      keepDropped: opts.keepDropped,
      limit: opts.limit,
      minScore: opts.minScore,
    });
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
    console.log(
      renderPipeline(db, { status: opts.status as JobStatus | undefined, minScore: opts.minScore }),
    );
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

const profileCmd = program
  .command('profile')
  .description('Build and maintain your living profile.');
profileCmd
  .command('build')
  .description('Interview + synthesize from PDFs in ./profile/.')
  .action(async () => {
    await runProfileBuild(loadConfig());
  });
profileCmd
  .command('update')
  .description('Incrementally edit the profile.')
  .option('--note <text>', 'freeform change to integrate')
  .action(async (o) => {
    await runProfileUpdate(loadConfig(), o.note);
  });
profileCmd
  .command('show')
  .description('Print profile.md.')
  .action(() => {
    runProfileShow(loadConfig());
  });

program
  .command('add')
  .description('Ingest specific posting URLs into the pipeline.')
  .argument('[urls...]', 'posting URLs')
  .option('--urls <file>', 'file with one URL per line')
  .option('--no-score', 'skip LLM scoring')
  .option('--keep-dropped', 'print prefilter-dropped jobs')
  .action(async (urlArgs: string[], opts) => {
    const cfg = loadConfig();
    const profile = loadProfile(cfg);
    if (!profile) throw new Error('No profile found. Run `lapel profile build` first.');
    const db = openDb(cfg.dbPath);
    migrate(db);
    const fromFile = opts.urls
      ? readFileSync(opts.urls, 'utf8')
          .split('\n')
          .map((s) => s.trim())
          .filter((s) => s && !s.startsWith('#')) // skip blanks and # comments
      : [];
    const urls = [...urlArgs, ...fromFile];
    if (urls.length === 0) throw new Error('Provide URLs as arguments or via --urls <file>.');
    const score =
      opts.score === false
        ? null
        : makeScorer({
            backend: createBackend(cfg),
            model: cfg.models.worker,
            batchSize: cfg.scoringBatchSize,
          });
    await runAdd({ db, profile, urls, score, keepDropped: opts.keepDropped });
  });

program
  .command('tailor')
  .description('Generate tailored resume summary + cover letter for a posting.')
  .argument('[job-id]', 'a job id from the pipeline', (v) => parseInt(v, 10))
  .option('--url <url>', 'a posting URL')
  .option('--text <file>', 'a file containing the posting text')
  .option('--opus', 'use the synthesis (Opus) tier')
  .option('--no-interview', 'skip the gap-interview')
  .action(async (jobId: number | undefined, opts) => {
    await runTailor(loadConfig(), {
      jobId: Number.isNaN(jobId) ? undefined : jobId,
      url: opts.url,
      textFile: opts.text,
      opus: opts.opus,
      interview: opts.interview,
    });
  });

program
  .command('mcp')
  .description('Start the lapel MCP server on stdio.')
  .action(async () => {
    await startMcpServer();
  });

program
  .command('leads')
  .description('Triage a messy leads file into companies.yaml (watchlist) + leads-urls.txt.')
  .argument('<file>', 'a markdown/text file of job leads')
  .option('--dry-run', 'print the plan without writing files')
  .action(async (file: string, opts) => {
    await runLeads(loadConfig(), file, { dryRun: opts.dryRun });
  });

program.parseAsync(process.argv).catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(process.env.LAPEL_DEBUG === '1' ? err : `Error: ${message}`);
  process.exit(1);
});

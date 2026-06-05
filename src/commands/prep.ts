import type { Config } from '../config.js';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { createBackend } from '../agent/backend.js';
import { structuredCall } from '../agent/llm.js';
import { openDb, migrate, getJobById } from '../db/index.js';
import { loadProfile } from '../profile/store.js';
import { fetchPostingText } from '../fetcher/posting.js';
import { loadPrepSession, savePrepSession } from '../prep/store.js';
import { runPrepSession, type PrepTurn } from '../prep/session.js';
import { writePrepRecap } from '../prep/recap.js';
import {
  PREP_SYSTEM,
  prepTurnUser,
  PrepTurnSchema,
  RECAP_SYSTEM,
  recapUserPrompt,
  PrepRecapSchema,
} from '../agent/prompts/prep.js';

export interface PrepCliOpts {
  jobId?: number;
  url?: string;
  textFile?: string;
  opus?: boolean;
}

export async function runPrep(cfg: Config, opts: PrepCliOpts): Promise<void> {
  const profile = loadProfile(cfg);
  if (!profile) throw new Error('No profile found. Run `lapel profile build` first.');
  if (!process.stdin.isTTY) throw new Error('prep is interactive; run it in a terminal.');

  const db = openDb(cfg.dbPath);
  migrate(db);
  const backend = createBackend(cfg);
  const model = opts.opus ? cfg.models.synth : cfg.models.worker;

  let company = 'company';
  let title = 'role';
  let postingText: string;
  let jobId: number | undefined;

  if (opts.jobId != null) {
    const job = getJobById(db, opts.jobId);
    if (!job) throw new Error(`No job with id ${opts.jobId}.`);
    jobId = job.id;
    company = job.company;
    title = job.title;
    postingText = job.description;
  } else if (opts.url) {
    const p = await fetchPostingText(opts.url);
    title = p.title ?? title;
    postingText = p.text;
  } else if (opts.textFile) {
    postingText = readFileSync(opts.textFile, 'utf8');
  } else {
    throw new Error('Provide a <job-id>, a URL, or --text <file>.');
  }

  const seeded = jobId != null ? (loadPrepSession(db, jobId) ?? []) : [];
  if (jobId == null) {
    console.log("(this session won't be remembered — prep a pipeline job by id to resume later)");
  }

  const respond = (transcript: PrepTurn[]): Promise<string> =>
    structuredCall({
      backend,
      model,
      system: PREP_SYSTEM,
      user: prepTurnUser(profile, postingText, transcript),
      toolName: 'emit_coach_turn',
      schema: PrepTurnSchema,
      maxTokens: 2048,
    }).then((r) => r.reply);

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let closed = false;
  rl.on('close', () => {
    closed = true;
  });
  const ask = async (): Promise<string | null> => {
    if (closed) return null;
    try {
      return (await rl.question('\n> ')).trim();
    } catch {
      return null; // readline closed mid-question (Ctrl-D)
    }
  };
  const say = (text: string): void => console.log(`\n${text}`);
  const onTurn =
    jobId != null ? (t: PrepTurn[]): void => savePrepSession(db, jobId as number, t) : undefined;

  let transcript: PrepTurn[];
  try {
    ({ transcript } = await runPrepSession({ transcript: seeded, respond, ask, say, onTurn }));
  } finally {
    rl.close();
  }

  const result = await writePrepRecap({
    outputDir: cfg.outputDir,
    profile,
    postingText,
    transcript,
    company,
    title,
    generate: (args) =>
      structuredCall({
        backend,
        model,
        system: RECAP_SYSTEM,
        user: recapUserPrompt(args.profile, args.postingText, args.transcript),
        toolName: 'emit_prep_recap',
        schema: PrepRecapSchema,
        maxTokens: 4096,
      }),
  });
  if (result) console.log(`\nInterview prep written to ${result.path}`);
  else console.log('\nNothing to recap yet.');
}

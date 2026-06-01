import type { Config } from '../config.js';
import { readFileSync } from 'node:fs';
import { createClient } from '../agent/client.js';
import { structuredCall } from '../agent/llm.js';
import { TAILOR_SYSTEM, tailorUserPrompt, TailorOutputSchema } from '../agent/prompts/tailor.js';
import { openDb, migrate, getJobById } from '../db/index.js';
import { loadProfile } from '../profile/store.js';
import { fetchPostingText } from '../fetcher/posting.js';
import { tailorPosting } from '../tailor/tailor.js';

export interface TailorCliOpts {
  jobId?: number;
  url?: string;
  textFile?: string;
  opus?: boolean;
  interview?: boolean;
}

export async function runTailor(cfg: Config, opts: TailorCliOpts): Promise<void> {
  const profile = loadProfile(cfg);
  if (!profile) throw new Error('No profile found. Run `job-scout profile build` first.');
  const db = openDb(cfg.dbPath);
  migrate(db);
  const client = createClient(cfg);

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

  // A later task inserts the optional gap-interview here (when opts.interview !== false).
  const model = opts.opus ? cfg.models.synth : cfg.models.worker;
  const result = await tailorPosting({
    db,
    outputDir: cfg.outputDir,
    profile,
    jobId,
    company,
    title,
    postingText,
    synthesize: ({ profile, postingText, extra }) =>
      structuredCall({
        client,
        model,
        system: TAILOR_SYSTEM,
        user: tailorUserPrompt(profile, postingText, extra),
        toolName: 'emit_tailored',
        schema: TailorOutputSchema,
        maxTokens: 4096,
      }),
  });
  console.log(`\nTailored docs written to ${result.dir}`);
}

import type { Config } from '../config.js';
import { readFileSync } from 'node:fs';
import { createClient } from '../agent/client.js';
import { structuredCall } from '../agent/llm.js';
import { TAILOR_SYSTEM, tailorUserPrompt, TailorOutputSchema } from '../agent/prompts/tailor.js';
import { openDb, migrate, getJobById } from '../db/index.js';
import { loadProfile, saveProfile } from '../profile/store.js';
import { fetchPostingText } from '../fetcher/posting.js';
import { tailorPosting } from '../tailor/tailor.js';
import { runGapInterview } from '../tailor/gap-interview.js';
import { GAP_SYSTEM, gapUserPrompt, GapsSchema } from '../agent/prompts/tailor-gap-interview.js';
import { createPrompter } from '../profile/interview.js';
import { confirmAndApply } from '../agent/propose.js';

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

  let extraExperience: string | undefined;
  let activeProfile = profile;
  if (opts.interview !== false && process.stdin.isTTY) {
    const ask = createPrompter();
    const { extraExperience: extra, proposals } = await runGapInterview({
      profile: activeProfile,
      postingText,
      identifyGaps: (p, posting) =>
        structuredCall({
          client,
          model: cfg.models.worker,
          system: GAP_SYSTEM,
          user: gapUserPrompt(p, posting),
          toolName: 'emit_gaps',
          schema: GapsSchema,
        }),
      ask,
    });
    extraExperience = extra || undefined;
    const confirm = async (reason: string) =>
      /^y/i.test(await ask(`Update your profile? ${reason} (y/N) `));
    for (const u of proposals) {
      const next = await confirmAndApply({
        profile: activeProfile,
        update: u,
        confirm,
        save: (pp) => saveProfile(cfg, pp),
      });
      if (next) activeProfile = next;
    }
  }
  const model = opts.opus ? cfg.models.synth : cfg.models.worker;
  const result = await tailorPosting({
    db,
    outputDir: cfg.outputDir,
    profile: activeProfile,
    jobId,
    company,
    title,
    postingText,
    extraExperience,
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

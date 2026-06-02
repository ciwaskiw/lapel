import type Database from 'better-sqlite3';
import { getJobs, getJobById, type JobStatus } from '../db/index.js';
import { ingest, type Scorer } from '../ingest/pipeline.js';
import { adapters, loadWatchlist } from '../sources/index.js';
import { fetchPostingText, urlToNormalizedJob, type PostingText } from '../fetcher/posting.js';
import { tailorPosting } from '../tailor/tailor.js';
import type { Gaps } from '../agent/prompts/tailor-gap-interview.js';
import type { TailorOutput } from '../agent/prompts/tailor.js';
import type { NormalizedJob } from '../sources/types.js';
import type { Profile } from '../profile/schema.js';

export interface HandlerDeps {
  scorer: Scorer | null;
  fetchPosting?: (url: string) => Promise<PostingText>;
  identifyGaps?: (profile: Profile, postingText: string) => Promise<Gaps>;
  synthesize?: (args: {
    profile: Profile;
    postingText: string;
    extra?: string;
  }) => Promise<TailorOutput>;
  outputDir?: string;
  companiesFile?: string;
}

export function makeHandlers(ctx: { db: Database.Database; profile: Profile; deps: HandlerDeps }) {
  const { db, profile, deps } = ctx;

  return {
    queryPipeline(args: { status?: JobStatus; minScore?: number }) {
      return { jobs: getJobs(db, args) };
    },

    async findJobs(args: { limit?: number; minScore?: number }) {
      const watchlist = loadWatchlist(deps.companiesFile!);
      const all: NormalizedJob[] = [];
      for (const e of watchlist) {
        try {
          all.push(...(await adapters[e.source].fetchJobs(e)));
        } catch (err) {
          // isolate per-company failures; MCP clients receive stderr
          console.error(`  ! ${e.source}:${e.slug} failed: ${(err as Error).message}`);
        }
      }
      const summary = await ingest(db, all, profile, { score: deps.scorer });
      return { ...summary, jobs: getJobs(db, { minScore: args.minScore, limit: args.limit }) };
    },

    async addJobs(args: { urls: string[] }) {
      const fetchPosting = deps.fetchPosting ?? ((u: string) => fetchPostingText(u));
      const jobs: NormalizedJob[] = [];
      for (const url of args.urls) {
        try {
          jobs.push(urlToNormalizedJob(url, await fetchPosting(url)));
        } catch (err) {
          // isolate per-url failures; MCP clients receive stderr
          console.error(`  ! ${url} failed: ${(err as Error).message}`);
        }
      }
      return ingest(db, jobs, profile, { score: deps.scorer });
    },

    async tailor(args: { jobId?: number; url?: string; text?: string; opus?: boolean }) {
      let company = 'company',
        title = 'role',
        postingText = '';
      let jobId: number | undefined;
      if (args.jobId != null) {
        const job = getJobById(db, args.jobId);
        if (!job) throw new Error(`No job with id ${args.jobId}.`);
        jobId = job.id;
        company = job.company;
        title = job.title;
        postingText = job.description;
      } else if (args.url) {
        const fetcher = deps.fetchPosting ?? ((u: string) => fetchPostingText(u));
        const r = await fetcher(args.url);
        title = r.title ?? title;
        postingText = r.text;
      } else if (args.text) {
        postingText = args.text;
      } else {
        throw new Error('Provide jobId, url, or text.');
      }

      const gapQuestions = deps.identifyGaps
        ? (await deps.identifyGaps(profile, postingText)).gaps.map((g) => g.question)
        : [];

      const result = await tailorPosting({
        db,
        outputDir: deps.outputDir!,
        profile,
        jobId,
        company,
        title,
        postingText,
        synthesize: deps.synthesize!,
      });
      return { paths: result, gapQuestions };
    },
  };
}

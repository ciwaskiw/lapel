import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { loadConfig } from '../config.js';
import { openDb, migrate } from '../db/index.js';
import { loadProfile } from '../profile/store.js';
import { createClient } from '../agent/client.js';
import { makeScorer } from '../scoring/score.js';
import { structuredCall } from '../agent/llm.js';
import { TAILOR_SYSTEM, tailorUserPrompt, TailorOutputSchema } from '../agent/prompts/tailor.js';
import { GAP_SYSTEM, gapUserPrompt, GapsSchema } from '../agent/prompts/tailor-gap-interview.js';
import { makeHandlers } from './handlers.js';

export async function startMcpServer(): Promise<void> {
  const cfg = loadConfig();
  const profile = loadProfile(cfg);
  if (!profile) throw new Error('No profile found. Run `job-scout profile build` first.');
  const db = openDb(cfg.dbPath);
  migrate(db);
  const client = createClient(cfg);

  const h = makeHandlers({
    db,
    profile,
    deps: {
      scorer: makeScorer({ client, model: cfg.models.worker, batchSize: cfg.scoringBatchSize }),
      companiesFile: cfg.companiesFile,
      outputDir: cfg.outputDir,
      identifyGaps: (p, posting) =>
        structuredCall({
          client,
          model: cfg.models.worker,
          system: GAP_SYSTEM,
          user: gapUserPrompt(p, posting),
          toolName: 'emit_gaps',
          schema: GapsSchema,
        }),
      synthesize: ({ profile, postingText, extra }) =>
        structuredCall({
          client,
          model: cfg.models.worker,
          system: TAILOR_SYSTEM,
          user: tailorUserPrompt(profile, postingText, extra),
          toolName: 'emit_tailored',
          schema: TailorOutputSchema,
          maxTokens: 4096,
        }),
    },
  });

  const server = new McpServer({ name: 'job-scout', version: '0.1.0' });

  server.tool(
    'query_pipeline',
    'View tracked jobs in the local pipeline.',
    { status: z.string().optional(), minScore: z.number().optional() },
    async (a) => ({
      content: [{ type: 'text', text: JSON.stringify(h.queryPipeline(a as never), null, 2) }],
    }),
  );

  server.tool(
    'find_jobs',
    'Crawl the ATS watchlist, score, and persist.',
    { limit: z.number().optional(), minScore: z.number().optional() },
    async (a) => ({
      content: [{ type: 'text', text: JSON.stringify(await h.findJobs(a), null, 2) }],
    }),
  );

  server.tool(
    'add_jobs',
    'Ingest specific posting URLs into the pipeline.',
    { urls: z.array(z.string()) },
    async (a) => ({
      content: [{ type: 'text', text: JSON.stringify(await h.addJobs(a), null, 2) }],
    }),
  );

  server.tool(
    'tailor',
    'Generate tailored docs; returns gap questions to optionally ask the user.',
    { jobId: z.number().optional(), url: z.string().optional(), text: z.string().optional() },
    async (a) => ({
      content: [{ type: 'text', text: JSON.stringify(await h.tailor(a), null, 2) }],
    }),
  );

  await server.connect(new StdioServerTransport());
}

import type Anthropic from '@anthropic-ai/sdk';
import { structuredCall } from '../agent/llm.js';
import { SCORE_SYSTEM, scoreUserPrompt } from '../agent/prompts/score.js';
import { JobScoreBatchSchema } from './rubric.js';
import type { JobScoreFields } from '../db/index.js';
import type { Scorer } from '../ingest/pipeline.js';
import type { NormalizedJob } from '../sources/types.js';
import type { Profile } from '../profile/schema.js';

type BatchCall = (
  client: Anthropic,
  model: string,
  profile: Profile,
  jobs: NormalizedJob[],
) => Promise<{
  scores: {
    externalId: string;
    score: number;
    matchedSkills: string[];
    missingSkills: string[];
    reasons: string;
  }[];
}>;

const defaultCall: BatchCall = (client, model, profile, jobs) =>
  structuredCall({
    client,
    model,
    system: SCORE_SYSTEM,
    user: scoreUserPrompt(profile, jobs),
    toolName: 'emit_scores',
    schema: JobScoreBatchSchema,
    maxTokens: 4096,
  });

export function makeScorer(deps: {
  client: Anthropic;
  model: string;
  batchSize: number;
  call?: BatchCall;
}): Scorer {
  const call = deps.call ?? defaultCall;
  return async (jobs, profile) => {
    const out = new Map<string, JobScoreFields>();
    for (let i = 0; i < jobs.length; i += deps.batchSize) {
      const batch = jobs.slice(i, i + deps.batchSize);
      try {
        const { scores } = await call(deps.client, deps.model, profile, batch);
        const byId = new Map(scores.map((s) => [s.externalId, s]));
        for (const j of batch) {
          const s = byId.get(j.externalId);
          if (s)
            out.set(`${j.source}:${j.externalId}`, {
              score: s.score,
              matchedSkills: s.matchedSkills,
              missingSkills: s.missingSkills,
              reasons: s.reasons,
            });
        }
      } catch (err) {
        console.error(
          `  ! scoring batch failed (${batch.length} jobs), leaving unscored: ${(err as Error).message}`,
        );
      }
    }
    return out;
  };
}

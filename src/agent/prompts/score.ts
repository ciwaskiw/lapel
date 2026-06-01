import type { Profile } from '../../profile/schema.js';
import { renderProfileMarkdown } from '../../profile/store.js';
import { RUBRIC } from '../../scoring/rubric.js';
import type { NormalizedJob } from '../../sources/types.js';

export const SCORE_SYSTEM = `You are a precise technical recruiter scoring job fit.\n${RUBRIC}`;

export function scoreUserPrompt(profile: Profile, jobs: NormalizedJob[]): string {
  const jobBlocks = jobs
    .map(
      (j) =>
        `### externalId: ${j.externalId}\nTitle: ${j.title}\nCompany: ${j.company}\nLocation: ${j.location ?? 'n/a'} (remote: ${j.remote ?? 'unknown'})\n${j.description.slice(0, 2500)}`,
    )
    .join('\n\n');
  return `CANDIDATE PROFILE:\n${renderProfileMarkdown(profile)}\n\nJOBS TO SCORE (return one score object per externalId):\n${jobBlocks}`;
}

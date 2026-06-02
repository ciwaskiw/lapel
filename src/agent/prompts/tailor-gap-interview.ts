import { z } from 'zod';
import type { Profile } from '../../profile/schema.js';
import { renderProfileMarkdown } from '../../profile/store.js';

export const GapsSchema = z.object({
  gaps: z
    .array(
      z.object({
        skill: z.string(),
        question: z
          .string()
          .describe('A specific question drawing out real experience with this skill.'),
      }),
    )
    .max(6),
});
export type Gaps = z.infer<typeof GapsSchema>;

export const GAP_SYSTEM = `You compare a job posting to a candidate profile and find the
high-emphasis requirements the posting stresses that the profile covers thinly or not at all.
Return up to 6 such gaps, RANKED most-important first (how heavily the posting emphasizes it × how
thin the profile is). The interview will only ask until the candidate gives ~3 substantive answers,
so the extras after the top 3 are backups for questions the candidate passes on.
For each, write one specific question that would surface real, concrete experience (scale, the
candidate's role, what they built). Do NOT ask about things already well-evidenced in the profile.
If there are no meaningful gaps, return an empty list.`;

export function gapUserPrompt(profile: Profile, posting: string): string {
  return `CANDIDATE PROFILE:\n${renderProfileMarkdown(profile)}\n\nJOB POSTING:\n${posting.slice(0, 8000)}`;
}

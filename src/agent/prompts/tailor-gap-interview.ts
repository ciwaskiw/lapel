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
    .max(3),
});
export type Gaps = z.infer<typeof GapsSchema>;

export const GAP_SYSTEM = `You compare a job posting to a candidate profile and find the TOP (max 3)
high-emphasis requirements the posting stresses that the profile covers thinly or not at all.
For each, write one specific question that would surface real, concrete experience (scale, the
candidate's role, what they built). Do NOT ask about things already well-evidenced in the profile.
If there are no meaningful gaps, return an empty list.`;

export function gapUserPrompt(profile: Profile, posting: string): string {
  return `CANDIDATE PROFILE:\n${renderProfileMarkdown(profile)}\n\nJOB POSTING:\n${posting.slice(0, 8000)}`;
}

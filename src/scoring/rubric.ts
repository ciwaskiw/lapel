import { z } from 'zod';

export const JobScoreSchema = z.object({
  externalId: z.string(),
  score: z.number().min(0).max(100),
  matchedSkills: z.array(z.string()),
  missingSkills: z.array(z.string()),
  reasons: z.string(),
});
export const JobScoreBatchSchema = z.object({ scores: z.array(JobScoreSchema) });
export type JobScoreItem = z.infer<typeof JobScoreSchema>;

export const RUBRIC = `Score each job 0-100 for fit with THIS candidate, weighting:
- Skills/tech overlap with the candidate's core skills (highest weight)
- Seniority alignment with the candidate's target seniority
- Location/remote compatibility with the candidate's preferences
- Alignment with the candidate's target roles
0-39 weak, 40-69 plausible, 70-100 strong. Be honest and specific; do not inflate.
Also weigh the candidate's stated must-haves (strong positives) and dealbreakers (strong negatives)
from their profile — but judge them IN CONTEXT, not by keyword presence. For example, a posting that
merely notes "no relocation assistance" is NOT a relocation conflict for a remote candidate; a role
that REQUIRES relocating is. Score a genuine dealbreaker conflict very low (0-20). Treat fuzzy
cultural preferences (e.g. agile process, testing culture, remote flexibility) as soft positives,
not requirements.
For each job return matchedSkills (candidate strengths the role wants), missingSkills
(role requirements the candidate lacks), and 1-3 sentences of reasons.`;

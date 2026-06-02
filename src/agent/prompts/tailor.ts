import { z } from 'zod';
import type { Profile } from '../../profile/schema.js';
import { renderProfileMarkdown } from '../../profile/store.js';

export const TailorOutputSchema = z.object({
  company: z.string(),
  roleTitle: z.string(),
  resumeSummary: z.string(),
  coverLetter: z.string(),
  fitNotes: z.string(),
  atsKeywords: z.array(z.string()),
});
export type TailorOutput = z.infer<typeof TailorOutputSchema>;

export const TAILOR_SYSTEM = `You tailor job application materials for a candidate.
ABSOLUTE RULE: never invent employers, titles, dates, skills, or achievements. Every claim must
trace to the candidate profile (or to extra experience the candidate explicitly provided). If the
role wants something the candidate lacks, do not fabricate it — omit it or, in fitNotes, name it as
a gap. Write in the candidate's voice: specific, grounded, no fluff.
Produce structured output via the emit_tailored tool:
- company: the hiring company's name, read from the posting (e.g. "Customer.io" — not "company")
- roleTitle: the clean role title (e.g. "Senior Software Engineer, Full Stack" — strip wrappers
  like "Job Application for … at …")
- resumeSummary: a tailored professional-summary + highlights section emphasizing the most relevant real experience
- coverLetter: a concise, specific cover letter
- fitNotes: honest notes on why this matched, key strengths to lead with, and any gaps
- atsKeywords: the key skills/terms from the posting that the candidate GENUINELY has (per the
  profile or provided experience), so they can ensure those terms appear in their full résumé.
  This is honest ATS alignment — NEVER include skills/terms the candidate does not actually have.`;

export function tailorUserPrompt(profile: Profile, posting: string, extra?: string): string {
  return (
    `CANDIDATE PROFILE:\n${renderProfileMarkdown(profile)}\n\nJOB POSTING:\n${posting.slice(0, 8000)}` +
    (extra
      ? `\n\nADDITIONAL REAL EXPERIENCE THE CANDIDATE PROVIDED (you may use this):\n${extra}`
      : '')
  );
}

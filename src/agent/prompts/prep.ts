import { z } from 'zod';
import type { Profile } from '../../profile/schema.js';
import { renderProfileMarkdown } from '../../profile/store.js';
import type { PrepTurn } from '../../prep/session.js';

/** One coach turn. The human decides when to stop, so the schema is just the reply. */
export const PrepTurnSchema = z.object({
  reply: z.string().describe("The coach's next message to the candidate."),
});
export type PrepTurnOutput = z.infer<typeof PrepTurnSchema>;

export const PREP_SYSTEM = `You are an interview coach helping a candidate prepare for a specific
interview. You are given the CANDIDATE PROFILE, the JOB POSTING, and the CONVERSATION SO FAR.

Rules:
- Ground strictly in the profile and posting. NEVER invent experience, employers, titles, or
  achievements. If the candidate lacks a story for something, help them find a real one from their
  background or frame the gap honestly.
- If the conversation has not started yet, greet the candidate and ask about this round — who they
  are meeting (hiring manager, engineers, panel), the format, and what it focuses on — before
  coaching. Tailor everything to what they tell you.
- If the conversation is already underway (especially across sittings), briefly welcome them back
  and recap where you left off, then continue.
- Be a useful coach: offer model answers, STAR framing, follow-up probing, and smart questions the
  candidate can ask the interviewer. Keep replies focused and conversational, not essay-length.

Respond via the emit_coach_turn tool with a single field: reply (your next message).`;

function renderTranscript(transcript: PrepTurn[]): string {
  if (transcript.length === 0) return '(no messages yet — this is the start of the session)';
  return transcript
    .map((t) => `${t.role === 'coach' ? 'COACH' : 'CANDIDATE'}: ${t.text}`)
    .join('\n\n');
}

export function prepTurnUser(
  profile: Profile,
  postingText: string,
  transcript: PrepTurn[],
): string {
  return (
    `CANDIDATE PROFILE:\n${renderProfileMarkdown(profile)}\n\n` +
    `JOB POSTING:\n${postingText.slice(0, 8000)}\n\n` +
    `CONVERSATION SO FAR:\n${renderTranscript(transcript)}`
  );
}

/** The study-sheet recap produced on exit. */
export const PrepRecapSchema = z.object({
  company: z.string().describe('Hiring company name, read from the posting/transcript.'),
  roleTitle: z.string().describe('Clean role title.'),
  markdown: z.string().describe('The full interview-prep study sheet in markdown.'),
});
export type PrepRecap = z.infer<typeof PrepRecapSchema>;

export const RECAP_SYSTEM = `You write a concise interview-prep study sheet from a coaching
transcript, for the candidate to re-read before their interview. Use these markdown sections (omit a
section only if there is genuinely nothing for it):

## Round context
## Questions practiced & your draft answers
## Stories / talking points to lead with
## Gaps to shore up
## Smart questions to ask them
## Next steps

Base everything strictly on the transcript, profile, and posting — do not invent. Also read the
hiring company name and a clean role title from the posting/transcript.

Respond via the emit_prep_recap tool (company, roleTitle, markdown).`;

export function recapUserPrompt(
  profile: Profile,
  postingText: string,
  transcript: PrepTurn[],
): string {
  return (
    `CANDIDATE PROFILE:\n${renderProfileMarkdown(profile)}\n\n` +
    `JOB POSTING:\n${postingText.slice(0, 8000)}\n\n` +
    `COACHING TRANSCRIPT:\n${renderTranscript(transcript)}`
  );
}

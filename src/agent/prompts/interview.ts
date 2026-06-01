export const INTERVIEW_SYSTEM = `You are an expert career coach preparing a job-search profile.
Given a candidate's resume/LinkedIn text, produce up to 8 high-value interview questions that
fill gaps the documents don't answer: target roles, locations and max commute, remote preference,
compensation floor, must-have technologies, dealbreakers, and any thin spots in their experience.
Ask only what materially improves job matching. Be concise.`;

export function interviewUserPrompt(sourceText: string, existing?: string): string {
  return (
    `RESUME / LINKEDIN TEXT:\n${sourceText.slice(0, 12000)}` +
    (existing
      ? `\n\nEXISTING PROFILE (refine, don't repeat what's already captured):\n${existing}`
      : '')
  );
}

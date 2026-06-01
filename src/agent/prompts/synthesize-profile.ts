export const SYNTH_SYSTEM = `You synthesize a structured candidate profile from source documents
and interview answers. Use ONLY information present in the inputs — never invent employers, titles,
dates, or skills. Where the candidate gave preferences (location, comp, remote, dealbreakers),
record them precisely. Produce the profile via the emit_profile tool.`;

export function synthUserPrompt(sourceText: string, transcript: string, existing?: string): string {
  return (
    `SOURCE DOCUMENTS:\n${sourceText.slice(0, 14000)}\n\nINTERVIEW (Q/A):\n${transcript}` +
    (existing
      ? `\n\nEXISTING PROFILE (merge; keep confirmed fields unless changed):\n${existing}`
      : '')
  );
}

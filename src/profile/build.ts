import type { Profile } from './schema.js';

export interface BuildProfileDeps {
  sourceText: string;
  existing: string | null;
  generateQuestions: (sourceText: string, existing: string | null) => Promise<{ questions: string[] }>;
  ask: (question: string) => Promise<string>;
  synthesize: (args: { sourceText: string; transcript: string; existing: string | null }) => Promise<Profile>;
}

export async function buildProfile(deps: BuildProfileDeps): Promise<Profile> {
  const { questions } = await deps.generateQuestions(deps.sourceText, deps.existing);
  const qa: string[] = [];
  for (const q of questions) {
    const a = await deps.ask(q);
    qa.push(`Q: ${q}\nA: ${a || '(skipped)'}`);
  }
  const profile = await deps.synthesize({ sourceText: deps.sourceText, transcript: qa.join('\n\n'), existing: deps.existing });
  return { ...profile, updatedAt: new Date().toISOString() };
}

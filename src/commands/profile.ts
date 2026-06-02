import { z } from 'zod';
import type { Config } from '../config.js';
import { createBackend } from '../agent/backend.js';
import { structuredCall } from '../agent/llm.js';
import { INTERVIEW_SYSTEM, interviewUserPrompt } from '../agent/prompts/interview.js';
import { SYNTH_SYSTEM, synthUserPrompt } from '../agent/prompts/synthesize-profile.js';
import { ProfileSchema } from '../profile/schema.js';
import { extractProfileSources } from '../profile/pdf.js';
import { loadProfile, saveProfile, renderProfileMarkdown } from '../profile/store.js';
import { buildProfile } from '../profile/build.js';
import { createPrompter } from '../profile/interview.js';

const QuestionsSchema = z.object({ questions: z.array(z.string()).max(8) });

export async function runProfileBuild(cfg: Config): Promise<void> {
  const backend = createBackend(cfg);
  const sources = await extractProfileSources(cfg.profileDir);
  if (sources.length === 0)
    throw new Error(
      `No PDFs found in ${cfg.profileDir}. Add your resume/LinkedIn export and retry.`,
    );
  const sourceText = sources.map((s) => `# ${s.file}\n${s.text}`).join('\n\n');
  const existingProfile = loadProfile(cfg);
  const existing = existingProfile ? renderProfileMarkdown(existingProfile) : null;
  const ask = createPrompter();

  const profile = await buildProfile({
    sourceText,
    existing,
    generateQuestions: (text, ex) =>
      structuredCall({
        backend,
        model: cfg.models.worker,
        system: INTERVIEW_SYSTEM,
        user: interviewUserPrompt(text, ex ?? undefined),
        toolName: 'emit_questions',
        schema: QuestionsSchema,
      }),
    ask,
    synthesize: ({ sourceText: st, transcript, existing: ex }) =>
      structuredCall({
        backend,
        model: cfg.models.synth,
        system: SYNTH_SYSTEM,
        user: synthUserPrompt(st, transcript, ex ?? undefined),
        toolName: 'emit_profile',
        schema: ProfileSchema,
        maxTokens: 4096,
      }),
  });

  saveProfile(cfg, profile);
  console.log(`\nProfile saved to ${cfg.profileJson} and ${cfg.profileMd}.`);
}

export async function runProfileUpdate(cfg: Config, note?: string): Promise<void> {
  const existing = loadProfile(cfg);
  if (!existing) throw new Error('No profile yet. Run `lapel profile build` first.');
  const backend = createBackend(cfg);
  const transcript = note
    ? `Q: Apply this update.\nA: ${note}`
    : await (async () => {
        const ask = createPrompter();
        const a = await ask('What would you like to change or add to your profile?');
        return `Q: What to change?\nA: ${a}`;
      })();
  const updated = await structuredCall({
    backend,
    model: cfg.models.synth,
    system: SYNTH_SYSTEM,
    user: synthUserPrompt('(see existing profile)', transcript, renderProfileMarkdown(existing)),
    toolName: 'emit_profile',
    schema: ProfileSchema,
    maxTokens: 4096,
  });
  saveProfile(cfg, { ...updated, updatedAt: new Date().toISOString() });
  console.log('Profile updated.');
}

export function runProfileShow(cfg: Config): void {
  const p = loadProfile(cfg);
  if (!p) throw new Error('No profile yet. Run `lapel profile build` first.');
  console.log(renderProfileMarkdown(p));
}

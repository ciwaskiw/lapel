import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Profile } from '../profile/schema.js';
import type { PrepTurn } from './session.js';
import type { PrepRecap } from '../agent/prompts/prep.js';
import { slug } from '../text/slug.js';

export interface RecapDeps {
  outputDir: string;
  profile: Profile;
  postingText: string;
  transcript: PrepTurn[];
  /** Fallbacks for the output folder when the model does not return company/title. */
  company: string;
  title: string;
  generate: (args: {
    profile: Profile;
    postingText: string;
    transcript: PrepTurn[];
  }) => Promise<PrepRecap>;
}

export interface RecapResult {
  path: string;
}

/** Generate + write the study-sheet recap. Returns null (writes nothing) for an empty session. */
export async function writePrepRecap(deps: RecapDeps): Promise<RecapResult | null> {
  const hasCandidate = deps.transcript.some((t) => t.role === 'candidate');
  if (!hasCandidate) return null;

  const recap = await deps.generate({
    profile: deps.profile,
    postingText: deps.postingText,
    transcript: deps.transcript,
  });
  const company = recap.company || deps.company;
  const title = recap.roleTitle || deps.title;
  const dir = path.join(deps.outputDir, `${slug(company)}-${slug(title)}`);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'interview-prep.md');
  writeFileSync(file, recap.markdown);
  return { path: file };
}

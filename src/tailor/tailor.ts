import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { insertApplication } from '../db/index.js';
import type { Profile } from '../profile/schema.js';
import type { TailorOutput } from '../agent/prompts/tailor.js';

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

export interface TailorDeps {
  db: Database.Database;
  outputDir: string;
  profile: Profile;
  jobId?: number;
  company: string;
  title: string;
  postingText: string;
  extraExperience?: string;
  synthesize: (args: {
    profile: Profile;
    postingText: string;
    extra?: string;
  }) => Promise<TailorOutput>;
}

export interface TailorResult {
  dir: string;
  resumePath: string;
  coverPath: string;
  fitNotesPath: string;
}

export async function tailorPosting(deps: TailorDeps): Promise<TailorResult> {
  const out = await deps.synthesize({
    profile: deps.profile,
    postingText: deps.postingText,
    extra: deps.extraExperience,
  });
  const dir = path.join(deps.outputDir, `${slug(deps.company)}-${slug(deps.title)}`);
  mkdirSync(dir, { recursive: true });
  const resumePath = path.join(dir, 'resume-summary.md');
  const coverPath = path.join(dir, 'cover-letter.md');
  const fitNotesPath = path.join(dir, 'fit-notes.md');
  writeFileSync(resumePath, out.resumeSummary);
  writeFileSync(coverPath, out.coverLetter);
  writeFileSync(fitNotesPath, out.fitNotes);
  if (deps.jobId != null)
    insertApplication(deps.db, { jobId: deps.jobId, resumePath, coverPath, fitNotesPath });
  return { dir, resumePath, coverPath, fitNotesPath };
}

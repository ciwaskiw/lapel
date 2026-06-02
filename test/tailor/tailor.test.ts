import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openDb, migrate, upsertJob, getApplication } from '../../src/db/index.js';
import { tailorPosting } from '../../src/tailor/tailor.js';
import type { Profile } from '../../src/profile/schema.js';
import type { NormalizedJob } from '../../src/sources/types.js';

const profile = {
  basics: { name: 'Chris' },
  skills: { core: [], familiar: [] },
  experience: [],
  notes: [],
  preferences: {},
} as unknown as Profile;
const job: NormalizedJob = {
  source: 'greenhouse',
  externalId: 'g1',
  company: 'Acme',
  title: 'Senior Eng',
  url: 'u',
  location: null,
  remote: null,
  description: 'TS role',
  postedAt: null,
  raw: {},
};

describe('tailorPosting', () => {
  let db: ReturnType<typeof openDb>;
  let outDir: string;
  beforeEach(() => {
    db = openDb(':memory:');
    migrate(db);
    outDir = mkdtempSync(path.join(tmpdir(), 'js-out-'));
  });

  it('writes three docs and records an application', async () => {
    const id = upsertJob(db, job).id;
    const synth = vi
      .fn()
      .mockResolvedValue({ resumeSummary: '# Summary', coverLetter: '# Cover', fitNotes: '# Fit' });
    const result = await tailorPosting({
      db,
      outputDir: outDir,
      profile,
      jobId: id,
      company: 'Acme',
      title: 'Senior Eng',
      postingText: 'TS role',
      synthesize: synth,
    });
    expect(existsSync(result.resumePath)).toBe(true);
    expect(readFileSync(result.coverPath, 'utf8')).toContain('Cover');
    expect(getApplication(db, id)).toBeTruthy();
  });

  it('works without a jobId (no application record)', async () => {
    const synth = vi
      .fn()
      .mockResolvedValue({ resumeSummary: 'r', coverLetter: 'c', fitNotes: 'f' });
    const result = await tailorPosting({
      db,
      outputDir: outDir,
      profile,
      company: 'Acme',
      title: 'Role',
      postingText: 'x',
      synthesize: synth,
    });
    expect(existsSync(result.resumePath)).toBe(true);
  });

  it('uses the model-provided company/role for the folder and appends ATS keywords to fit-notes', async () => {
    const synth = vi.fn().mockResolvedValue({
      company: 'Customer.io',
      roleTitle: 'Senior Software Engineer, Full Stack',
      resumeSummary: 'r',
      coverLetter: 'c',
      fitNotes: '# Fit',
      atsKeywords: ['TypeScript', 'AWS Lambda'],
    });
    const result = await tailorPosting({
      db,
      outputDir: outDir,
      profile,
      company: 'company', // the bad default a URL-tailor would pass
      title: 'Job Application for … at Customer.io',
      postingText: 'x',
      synthesize: synth,
    });
    // folder uses the model's clean company/role, not the "company" default
    expect(result.dir).toContain('customer-io-senior-software-engineer-full-stack');
    const fit = readFileSync(result.fitNotesPath, 'utf8');
    expect(fit).toContain('## ATS keywords');
    expect(fit).toContain('- TypeScript');
    expect(fit).toContain('- AWS Lambda');
  });
});

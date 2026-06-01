import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, migrate, upsertJob, getJobs, getJobById, existingKeys, setStatus, insertApplication, getApplication } from '../../src/db/index.js';
import type { NormalizedJob } from '../../src/sources/types.js';

function sampleJob(over: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    source: 'greenhouse', externalId: 'g1', company: 'Acme', title: 'Senior Engineer',
    url: 'https://acme.example/jobs/g1', location: 'Remote', remote: true,
    description: 'Build things', postedAt: null, raw: { id: 'g1' }, ...over,
  };
}

describe('db', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => { db = openDb(':memory:'); migrate(db); });

  it('inserts a new job with status=new and score null', () => {
    const r = upsertJob(db, sampleJob());
    expect(r.inserted).toBe(true);
    const row = getJobById(db, r.id)!;
    expect(row.status).toBe('new');
    expect(row.score).toBeNull();
    expect(row.company).toBe('Acme');
  });

  it('upsert updates mutable fields but never resets a non-new status', () => {
    const r = upsertJob(db, sampleJob());
    setStatus(db, r.id, 'applied');
    const r2 = upsertJob(db, sampleJob({ title: 'Staff Engineer' }));
    expect(r2.inserted).toBe(false);
    const row = getJobById(db, r.id)!;
    expect(row.title).toBe('Staff Engineer');
    expect(row.status).toBe('applied');
  });

  it('persists scoring fields when provided', () => {
    const r = upsertJob(db, sampleJob(), { score: 87, matchedSkills: ['TS'], missingSkills: ['Go'], reasons: 'strong' });
    const row = getJobById(db, r.id)!;
    expect(row.score).toBe(87);
    expect(JSON.parse(row.matched_skills!)).toEqual(['TS']);
  });

  it('filters by status and minScore', () => {
    const a = upsertJob(db, sampleJob({ externalId: 'a' }), { score: 90, matchedSkills: [], missingSkills: [], reasons: '' });
    upsertJob(db, sampleJob({ externalId: 'b' }), { score: 40, matchedSkills: [], missingSkills: [], reasons: '' });
    setStatus(db, a.id, 'interested');
    expect(getJobs(db, { status: 'interested' }).map((j) => j.external_id)).toEqual(['a']);
    expect(getJobs(db, { minScore: 80 }).map((j) => j.external_id)).toEqual(['a']);
  });

  it('upserts applications by job_id', () => {
    const r = upsertJob(db, sampleJob());
    insertApplication(db, { jobId: r.id, resumePath: 'a.md', coverPath: 'b.md', fitNotesPath: 'c.md' });
    insertApplication(db, { jobId: r.id, resumePath: 'a2.md', coverPath: 'b2.md', fitNotesPath: 'c2.md' });
    expect(getApplication(db, r.id)!.resume_path).toBe('a2.md');
  });

  it('existingKeys exposes both source:externalId keys and urls', () => {
    upsertJob(db, sampleJob({ externalId: 'a', url: 'https://x/a' }));
    upsertJob(db, sampleJob({ externalId: 'b', url: 'https://x/b' }));
    const { ids, urls } = existingKeys(db);
    expect(ids.has('greenhouse:a')).toBe(true);
    expect(ids.has('greenhouse:b')).toBe(true);
    expect(ids.has('greenhouse:missing')).toBe(false);
    expect(urls.has('https://x/a')).toBe(true);
    expect(urls.has('https://x/missing')).toBe(false);
  });

  it('migrate is idempotent (safe to run twice)', () => {
    expect(() => migrate(db)).not.toThrow();
    const r = upsertJob(db, sampleJob());
    expect(getJobById(db, r.id)!.company).toBe('Acme');
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, migrate, upsertJob, getJobs } from '../../src/db/index.js';
import { runRemove } from '../../src/commands/remove.js';
import type { NormalizedJob } from '../../src/sources/types.js';

const j = (id: string, company = 'Acme'): NormalizedJob => ({
  source: 'greenhouse',
  externalId: id,
  company,
  title: 'Senior Eng',
  url: `http://${id}`,
  location: null,
  remote: null,
  description: '',
  postedAt: null,
  raw: {},
});

describe('runRemove', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    db = openDb(':memory:');
    migrate(db);
  });

  it('removes by company', () => {
    upsertJob(db, j('a', 'Acme'));
    upsertJob(db, j('b', 'Globex'));
    const msg = runRemove(db, { company: 'Acme' });
    expect(msg).toMatch(/Removed 1 job/);
    expect(getJobs(db, {})).toHaveLength(1);
  });

  it('removes by id', () => {
    const a = upsertJob(db, j('a'));
    expect(runRemove(db, { id: a.id })).toMatch(/Removed job/);
    expect(getJobs(db, {})).toHaveLength(0);
  });

  it('reports an unknown id', () => {
    expect(runRemove(db, { id: 9999 })).toMatch(/No job with id 9999/);
  });

  it('errors when neither company nor id is given', () => {
    expect(() => runRemove(db, {})).toThrow(/Provide a/);
  });

  it('errors when both company and id are given', () => {
    expect(() => runRemove(db, { company: 'Acme', id: 1 })).toThrow(/either/);
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, migrate, upsertJob, getJobById } from '../../src/db/index.js';
import { renderPipeline, changeStatus } from '../../src/commands/pipeline.js';
import type { NormalizedJob } from '../../src/sources/types.js';

const j = (id: string): NormalizedJob => ({
  source: 'greenhouse', externalId: id, company: 'Acme', title: 'Senior Eng', url: `http://${id}`,
  location: 'Remote', remote: true, description: '', postedAt: null, raw: {},
});

describe('pipeline + status', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => { db = openDb(':memory:'); migrate(db); });

  it('renders a table filtered by status', () => {
    const a = upsertJob(db, j('a'));
    upsertJob(db, j('b'));
    changeStatus(db, a.id, 'interested');
    const out = renderPipeline(db, { status: 'interested' });
    expect(out).toContain('Acme');
    expect(out).toContain(String(a.id));
  });

  it('changeStatus validates the target state', () => {
    const a = upsertJob(db, j('a'));
    expect(() => changeStatus(db, a.id, 'bogus' as never)).toThrow(/invalid status/i);
    expect(changeStatus(db, a.id, 'applied')).toBe(true);
    expect(getJobById(db, a.id)!.status).toBe('applied');
  });

  it('changeStatus throws on unknown job id', () => {
    expect(() => changeStatus(db, 999, 'applied')).toThrow(/no job/i);
  });
});

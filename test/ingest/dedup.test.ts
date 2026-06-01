import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, migrate, upsertJob } from '../../src/db/index.js';
import { dedup } from '../../src/ingest/dedup.js';
import type { NormalizedJob } from '../../src/sources/types.js';

const j = (over: Partial<NormalizedJob>): NormalizedJob => ({
  source: 'greenhouse',
  externalId: 'x',
  company: 'A',
  title: 'T',
  url: 'u',
  location: null,
  remote: null,
  description: '',
  postedAt: null,
  raw: {},
  ...over,
});

describe('dedup', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    db = openDb(':memory:');
    migrate(db);
  });

  it('drops jobs already in db by (source, externalId) or url', () => {
    upsertJob(db, j({ externalId: 'a', url: 'http://a' }));
    const { fresh, duplicates } = dedup(db, [
      j({ externalId: 'a', url: 'http://a' }),
      j({ externalId: 'b', url: 'http://a' }),
      j({ externalId: 'c', url: 'http://c' }),
    ]);
    expect(fresh.map((f) => f.externalId)).toEqual(['c']);
    expect(duplicates).toHaveLength(2);
  });

  it('dedups within the same batch', () => {
    const { fresh } = dedup(db, [
      j({ externalId: 'a', url: 'http://a' }),
      j({ externalId: 'a', url: 'http://a' }),
    ]);
    expect(fresh).toHaveLength(1);
  });
});

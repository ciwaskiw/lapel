import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, migrate, getJobs } from '../../src/db/index.js';
import { ingest } from '../../src/ingest/pipeline.js';
import type { Profile } from '../../src/profile/schema.js';
import type { NormalizedJob } from '../../src/sources/types.js';

const profile: Profile = {
  version: 1,
  updatedAt: '',
  basics: { name: '', headline: '', yearsExperience: 8, summary: '' },
  skills: { core: [], familiar: [] },
  experience: [],
  notes: [],
  preferences: {
    targetRoles: [],
    seniority: [],
    locations: [],
    remote: 'any',
    maxCommuteMiles: null,
    minBaseComp: null,
    mustHave: [],
    dealbreakers: ['PHP'],
  },
};
const j = (id: string, over: Partial<NormalizedJob> = {}): NormalizedJob => ({
  source: 'greenhouse',
  externalId: id,
  company: 'A',
  title: 'Senior Engineer',
  url: `http://${id}`,
  location: 'Remote',
  remote: true,
  description: 'TypeScript',
  postedAt: null,
  raw: {},
  ...over,
});

describe('ingest', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    db = openDb(':memory:');
    migrate(db);
  });

  it('dedups, prefilters, persists with status=new and no scorer leaves score null', async () => {
    const summary = await ingest(db, [j('a'), j('b', { title: 'Marketing Manager' })], profile, {
      score: null,
    });
    expect(summary.added).toBe(1);
    expect(summary.dropped).toBe(1);
    const rows = getJobs(db, {});
    expect(rows).toHaveLength(1);
    expect(rows[0].score).toBeNull();
    expect(rows[0].status).toBe('new');
  });

  it('applies an injected scorer', async () => {
    const scorer = async (jobs: NormalizedJob[]) =>
      new Map(
        jobs.map((x) => [
          `${x.source}:${x.externalId}`,
          { score: 75, matchedSkills: ['TS'], missingSkills: [], reasons: 'ok' },
        ]),
      );
    const summary = await ingest(db, [j('a')], profile, { score: scorer });
    expect(summary.added).toBe(1);
    expect(getJobs(db, {})[0].score).toBe(75);
  });
});

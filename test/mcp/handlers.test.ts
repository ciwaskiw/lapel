import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openDb, migrate, upsertJob } from '../../src/db/index.js';
import { makeHandlers } from '../../src/mcp/handlers.js';
import type { Profile } from '../../src/profile/schema.js';
import type { NormalizedJob } from '../../src/sources/types.js';

const profile = {
  preferences: {
    dealbreakers: [],
    mustHave: [],
    seniority: [],
    remote: 'any',
    targetRoles: [],
    locations: [],
    maxCommuteMiles: null,
    minBaseComp: null,
  },
  skills: { core: [], familiar: [] },
  experience: [],
  notes: [],
  basics: { name: 'C' },
} as unknown as Profile;
const job = (id: string): NormalizedJob => ({
  source: 'greenhouse',
  externalId: id,
  company: 'Acme',
  title: 'Senior Eng',
  url: `http://${id}`,
  location: 'Remote',
  remote: true,
  description: 'TS',
  postedAt: null,
  raw: {},
});

describe('mcp handlers', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    db = openDb(':memory:');
    migrate(db);
  });

  it('query_pipeline returns rows as structured json', () => {
    upsertJob(db, job('a'));
    const h = makeHandlers({ db, profile, deps: {} as never });
    const out = h.queryPipeline({});
    expect(out.jobs).toHaveLength(1);
    expect(out.jobs[0].company).toBe('Acme');
  });

  it('add_jobs ingests urls', async () => {
    const fetchPosting = vi.fn().mockResolvedValue({ title: 'Senior Eng', text: 'TS' });
    const h = makeHandlers({ db, profile, deps: { fetchPosting, scorer: null } as never });
    const out = await h.addJobs({ urls: ['http://x'] });
    expect(out.added).toBe(1);
  });

  it('tailor returns gap questions instead of prompting (non-interactive)', async () => {
    const id = upsertJob(db, job('a')).id;
    const identifyGaps = vi
      .fn()
      .mockResolvedValue({ gaps: [{ skill: 'Kafka', question: 'Kafka experience?' }] });
    const synthesize = vi
      .fn()
      .mockResolvedValue({ resumeSummary: 'r', coverLetter: 'c', fitNotes: 'f' });
    const h = makeHandlers({
      db,
      profile,
      deps: { identifyGaps, synthesize, outputDir: '/tmp/js-mcp' } as never,
    });
    const out = await h.tailor({ jobId: id });
    expect(out.gapQuestions).toEqual(['Kafka experience?']);
    expect(out.paths.coverPath).toContain('cover-letter.md');
  });
});

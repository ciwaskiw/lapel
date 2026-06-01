import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openDb, migrate, getJobs } from '../../src/db/index.js';
import { runAdd } from '../../src/commands/add.js';
import type { Profile } from '../../src/profile/schema.js';

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
} as unknown as Profile;

describe('runAdd', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    db = openDb(':memory:');
    migrate(db);
  });

  it('fetches each url, normalizes, and ingests', async () => {
    const fetchPosting = vi
      .fn()
      .mockResolvedValueOnce({ title: 'Senior Eng', text: 'TypeScript role' })
      .mockResolvedValueOnce({ title: 'Staff Eng', text: 'Node role' });
    const summary = await runAdd({
      db,
      profile,
      urls: ['https://a.example/1', 'https://b.example/2'],
      score: null,
      fetchPosting,
      log: () => {},
    });
    expect(fetchPosting).toHaveBeenCalledTimes(2);
    expect(summary.added).toBe(2);
    expect(getJobs(db, {}).map((j) => j.source)).toEqual(['url', 'url']);
  });

  it('isolates a failing url', async () => {
    const fetchPosting = vi
      .fn()
      .mockRejectedValueOnce(new Error('404'))
      .mockResolvedValueOnce({ title: 'OK', text: 'desc' });
    const summary = await runAdd({
      db,
      profile,
      urls: ['x', 'y'],
      score: null,
      fetchPosting,
      log: () => {},
    });
    expect(summary.added).toBe(1);
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { openDb, migrate, getJobs } from '../../src/db/index.js';
import { runFind } from '../../src/commands/find.js';
import type { Profile } from '../../src/profile/schema.js';
import type { NormalizedJob, WatchlistEntry } from '../../src/sources/types.js';

const profile: Profile = {
  version: 1, updatedAt: '', basics: { name: '', headline: '', yearsExperience: 8, summary: '' },
  skills: { core: [], familiar: [] }, experience: [], notes: [],
  preferences: { targetRoles: [], seniority: [], locations: [], remote: 'any', maxCommuteMiles: null, minBaseComp: null, mustHave: [], dealbreakers: [] },
};
const job = (id: string): NormalizedJob => ({
  source: 'greenhouse', externalId: id, company: 'Acme', title: 'Senior Eng', url: `http://${id}`,
  location: 'Remote', remote: true, description: 'TS', postedAt: null, raw: {},
});

describe('runFind', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => { db = openDb(':memory:'); migrate(db); });

  it('fetches from each watchlist entry via injected adapters and persists', async () => {
    const watchlist: WatchlistEntry[] = [{ source: 'greenhouse', slug: 'acme', name: 'Acme' }];
    const fetchAdapter = vi.fn().mockResolvedValue([job('a'), job('b')]);
    const summary = await runFind({
      db, profile, watchlist, score: null,
      fetchEntry: fetchAdapter, log: () => {},
    });
    expect(fetchAdapter).toHaveBeenCalledOnce();
    expect(summary.added).toBe(2);
    expect(getJobs(db, {})).toHaveLength(2);
  });

  it('isolates a failing watchlist entry', async () => {
    const watchlist: WatchlistEntry[] = [
      { source: 'greenhouse', slug: 'bad' },
      { source: 'lever', slug: 'good' },
    ];
    const fetchEntry = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce([job('c')]);
    const summary = await runFind({ db, profile, watchlist, score: null, fetchEntry, log: () => {} });
    expect(summary.added).toBe(1);
  });
});

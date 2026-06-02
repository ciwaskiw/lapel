import { describe, it, expect, vi } from 'vitest';
import { makeScorer } from '../../src/scoring/score.js';
import type { NormalizedJob } from '../../src/sources/types.js';
import type { Profile } from '../../src/profile/schema.js';

const profile = {
  preferences: {},
  skills: { core: [], familiar: [] },
  basics: {},
  experience: [],
  notes: [],
} as unknown as Profile;
const job = (id: string): NormalizedJob => ({
  source: 'greenhouse',
  externalId: id,
  company: 'A',
  title: 'T',
  url: 'u',
  location: null,
  remote: null,
  description: 'd',
  postedAt: null,
  raw: {},
});

describe('makeScorer', () => {
  it('maps batch results back to job keys', async () => {
    const fakeCall = vi.fn().mockResolvedValue({
      scores: [
        { externalId: 'a', score: 80, matchedSkills: ['TS'], missingSkills: [], reasons: 'good' },
        { externalId: 'b', score: 30, matchedSkills: [], missingSkills: ['Go'], reasons: 'weak' },
      ],
    });
    const scorer = makeScorer({ backend: {} as never, model: 'm', batchSize: 10, call: fakeCall });
    const result = await scorer([job('a'), job('b')], profile);
    expect(result.get('greenhouse:a')!.score).toBe(80);
    expect(result.get('greenhouse:b')!.missingSkills).toEqual(['Go']);
  });

  it('batches by batchSize', async () => {
    const fakeCall = vi.fn().mockImplementation(async (_c, _m, _p, jobs: NormalizedJob[]) => ({
      scores: jobs.map((j) => ({
        externalId: j.externalId,
        score: 50,
        matchedSkills: [],
        missingSkills: [],
        reasons: '',
      })),
    }));
    const scorer = makeScorer({ backend: {} as never, model: 'm', batchSize: 2, call: fakeCall });
    await scorer([job('a'), job('b'), job('c')], profile);
    expect(fakeCall).toHaveBeenCalledTimes(2);
  });

  it('isolates a failing batch (leaves those jobs unscored)', async () => {
    const fakeCall = vi.fn().mockRejectedValue(new Error('llm down'));
    const scorer = makeScorer({ backend: {} as never, model: 'm', batchSize: 10, call: fakeCall });
    const result = await scorer([job('a')], profile);
    expect(result.size).toBe(0);
  });
});

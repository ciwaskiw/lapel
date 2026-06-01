import { describe, it, expect, vi } from 'vitest';
import { buildProfile } from '../../src/profile/build.js';
import type { Profile } from '../../src/profile/schema.js';

const synthesized: Profile = {
  version: 1,
  updatedAt: '2026-06-01T00:00:00.000Z',
  basics: { name: 'Chris', headline: 'FS Eng', yearsExperience: 8, summary: 's' },
  skills: { core: ['TS'], familiar: [] },
  experience: [],
  notes: [],
  preferences: {
    targetRoles: ['Senior FS'],
    seniority: ['senior'],
    locations: ['Remote'],
    remote: 'remote',
    maxCommuteMiles: 30,
    minBaseComp: null,
    mustHave: ['TypeScript'],
    dealbreakers: [],
  },
};

describe('buildProfile', () => {
  it('runs interview then synthesis and returns a valid profile', async () => {
    const genQuestions = vi.fn().mockResolvedValue({ questions: ['What roles?', 'Remote?'] });
    const ask = vi.fn().mockResolvedValueOnce('Senior FS').mockResolvedValueOnce('Remote only');
    const synth = vi.fn().mockResolvedValue(synthesized);

    const profile = await buildProfile({
      sourceText: 'resume text',
      existing: null,
      generateQuestions: genQuestions,
      ask,
      synthesize: synth,
    });

    expect(ask).toHaveBeenCalledTimes(2);
    expect(synth).toHaveBeenCalledOnce();
    expect(profile.preferences.maxCommuteMiles).toBe(30);
    expect((synth.mock.calls[0][0] as { transcript: string }).transcript).toContain('Senior FS');
    // updatedAt is refreshed to "now" (not the synthesized fixture's value)
    expect(profile.updatedAt).not.toBe('2026-06-01T00:00:00.000Z');
  });

  it('records skipped answers without crashing', async () => {
    const genQuestions = vi.fn().mockResolvedValue({ questions: ['Q1'] });
    const ask = vi.fn().mockResolvedValue('');
    const synth = vi.fn().mockResolvedValue(synthesized);
    await buildProfile({
      sourceText: 's',
      existing: null,
      generateQuestions: genQuestions,
      ask,
      synthesize: synth,
    });
    expect((synth.mock.calls[0][0] as { transcript: string }).transcript).toContain('(skipped)');
  });
});

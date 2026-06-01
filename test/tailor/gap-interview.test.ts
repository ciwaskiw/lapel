import { describe, it, expect, vi } from 'vitest';
import { runGapInterview } from '../../src/tailor/gap-interview.js';
import type { Profile } from '../../src/profile/schema.js';

const profile = {
  skills: { core: ['TS'], familiar: [] },
  experience: [],
  notes: [],
  preferences: {},
  basics: {},
} as unknown as Profile;

describe('runGapInterview', () => {
  it('asks each gap question and returns extra experience + proposals', async () => {
    const identify = vi.fn().mockResolvedValue({
      gaps: [{ skill: 'Kafka', question: 'Tell me about your Kafka experience.' }],
    });
    const ask = vi.fn().mockResolvedValue('Ran Kafka at 1M msgs/sec for 3 years.');
    const { extraExperience, proposals } = await runGapInterview({
      profile,
      postingText: 'Kafka role',
      identifyGaps: identify,
      ask,
    });
    expect(extraExperience).toContain('Kafka');
    expect(proposals[0].reason).toMatch(/Kafka/);
    expect(proposals[0].addCoreSkills).toContain('Kafka');
  });

  it('skips a gap the user cannot speak to and proposes nothing for it', async () => {
    const identify = vi
      .fn()
      .mockResolvedValue({ gaps: [{ skill: 'COBOL', question: 'COBOL experience?' }] });
    const ask = vi.fn().mockResolvedValue('skip');
    const { extraExperience, proposals } = await runGapInterview({
      profile,
      postingText: 'x',
      identifyGaps: identify,
      ask,
    });
    expect(extraExperience).toBe('');
    expect(proposals).toHaveLength(0);
  });

  it('returns empty when there are no gaps', async () => {
    const identify = vi.fn().mockResolvedValue({ gaps: [] });
    const ask = vi.fn();
    const { proposals } = await runGapInterview({
      profile,
      postingText: 'x',
      identifyGaps: identify,
      ask,
    });
    expect(ask).not.toHaveBeenCalled();
    expect(proposals).toHaveLength(0);
  });
});

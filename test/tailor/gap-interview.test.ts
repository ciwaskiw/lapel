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

  it('lets the user pass on questions and backfills until the target is answered', async () => {
    const identify = vi.fn().mockResolvedValue({
      gaps: [
        { skill: 'Postgres', question: 'Q1' },
        { skill: 'Kafka', question: 'Q2' },
        { skill: 'Go', question: 'Q3' },
        { skill: 'GraphQL', question: 'Q4' },
        { skill: 'Redis', question: 'Q5' }, // backup — should never be asked
      ],
    });
    const ask = vi
      .fn()
      .mockResolvedValueOnce('pass') // Q1 passed
      .mockResolvedValueOnce('Built the Kafka pipeline') // Q2 answered (1)
      .mockResolvedValueOnce('Wrote services in Go') // Q3 answered (2)
      .mockResolvedValueOnce('Owned the GraphQL layer'); // Q4 answered (3) → stop
    const { proposals } = await runGapInterview({
      profile,
      postingText: 'x',
      identifyGaps: identify,
      ask,
    });
    expect(proposals.map((p) => p.addCoreSkills?.[0])).toEqual(['Kafka', 'Go', 'GraphQL']);
    expect(ask).toHaveBeenCalledTimes(4); // passed Q1, answered Q2-Q4, stopped before Q5
  });

  it('treats "pass" as a skip (no proposal)', async () => {
    const identify = vi
      .fn()
      .mockResolvedValue({ gaps: [{ skill: 'Postgres', question: 'Relational DB story?' }] });
    const ask = vi.fn().mockResolvedValue('pass');
    const { proposals } = await runGapInterview({
      profile,
      postingText: 'x',
      identifyGaps: identify,
      ask,
    });
    expect(proposals).toHaveLength(0);
  });
});

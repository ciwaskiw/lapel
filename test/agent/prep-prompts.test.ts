import { describe, it, expect } from 'vitest';
import {
  prepTurnUser,
  PrepTurnSchema,
  recapUserPrompt,
  PrepRecapSchema,
} from '../../src/agent/prompts/prep.js';
import type { Profile } from '../../src/profile/schema.js';
import type { PrepTurn } from '../../src/prep/session.js';

const profile = {
  skills: { core: ['TypeScript'], familiar: [] },
  experience: [],
  notes: [],
  preferences: {
    targetRoles: [],
    seniority: [],
    locations: [],
    remote: true,
    mustHave: [],
    dealbreakers: [],
  },
  basics: {},
} as unknown as Profile;

describe('prep prompts', () => {
  it('prepTurnUser includes profile, posting, and a start marker when empty', () => {
    const user = prepTurnUser(profile, 'Senior Engineer at Acme', []);
    expect(user).toContain('CANDIDATE PROFILE:');
    expect(user).toContain('JOB POSTING:');
    expect(user).toContain('Senior Engineer at Acme');
    expect(user).toMatch(/start of the session/i);
  });

  it('prepTurnUser renders the transcript with COACH/CANDIDATE labels', () => {
    const transcript: PrepTurn[] = [
      { role: 'coach', text: 'What round is this?' },
      { role: 'candidate', text: 'Technical screen.' },
    ];
    const user = prepTurnUser(profile, 'posting', transcript);
    expect(user).toContain('COACH: What round is this?');
    expect(user).toContain('CANDIDATE: Technical screen.');
  });

  it('PrepTurnSchema accepts a reply object', () => {
    expect(PrepTurnSchema.safeParse({ reply: 'Let us begin.' }).success).toBe(true);
    expect(PrepTurnSchema.safeParse({}).success).toBe(false);
  });

  it('recapUserPrompt includes the transcript; PrepRecapSchema validates a recap', () => {
    const user = recapUserPrompt(profile, 'posting', [
      { role: 'candidate', text: 'My Kafka story...' },
    ]);
    expect(user).toContain('My Kafka story');
    expect(
      PrepRecapSchema.safeParse({ company: 'Acme', roleTitle: 'SWE', markdown: '## Round' })
        .success,
    ).toBe(true);
  });
});

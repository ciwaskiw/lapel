import { describe, it, expect } from 'vitest';
import { prefilter } from '../../src/ingest/prefilter.js';
import type { Profile } from '../../src/profile/schema.js';
import type { NormalizedJob } from '../../src/sources/types.js';

const profile = (over: Partial<Profile['preferences']> = {}): Profile => ({
  version: 1,
  updatedAt: '',
  basics: { name: '', headline: '', yearsExperience: 8, summary: '' },
  skills: { core: [], familiar: [] },
  experience: [],
  notes: [],
  preferences: {
    targetRoles: [],
    seniority: ['senior', 'staff'],
    locations: [],
    remote: 'any',
    maxCommuteMiles: null,
    minBaseComp: null,
    mustHave: ['TypeScript'],
    dealbreakers: ['PHP'],
    ...over,
  },
});

const j = (over: Partial<NormalizedJob>): NormalizedJob => ({
  source: 'greenhouse',
  externalId: 'x',
  company: 'A',
  title: 'Senior Engineer',
  url: 'u',
  location: 'Remote',
  remote: true,
  description: 'We use TypeScript and Node',
  postedAt: null,
  raw: {},
  ...over,
});

describe('prefilter', () => {
  it('drops on dealbreaker term', () => {
    const { dropped } = prefilter([j({ description: 'Legacy PHP shop' })], profile());
    expect(dropped[0].reason).toMatch(/dealbreaker/i);
  });

  it('drops when no mustHave term is present anywhere', () => {
    const { dropped } = prefilter([j({ title: 'Engineer', description: 'We use Go' })], profile());
    expect(dropped[0].reason).toMatch(/must-have/i);
  });

  it('drops on clear seniority mismatch', () => {
    const { dropped } = prefilter([j({ title: 'Junior Engineer Intern' })], profile());
    expect(dropped[0].reason).toMatch(/seniority/i);
  });

  it('drops onsite job when preference is remote', () => {
    const { dropped } = prefilter(
      [j({ remote: false, location: 'New York, NY' })],
      profile({ remote: 'remote' }),
    );
    expect(dropped[0].reason).toMatch(/remote/i);
  });

  it('keeps a clearly matching job', () => {
    const { kept, dropped } = prefilter([j({})], profile());
    expect(kept).toHaveLength(1);
    expect(dropped).toHaveLength(0);
  });

  it('keeps when unsure (no mustHave configured)', () => {
    const { kept } = prefilter([j({ description: 'We use Go' })], profile({ mustHave: [] }));
    expect(kept).toHaveLength(1);
  });
});

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
    targetRoles: ['Senior Full-stack Engineer'],
    seniority: ['senior', 'staff'],
    locations: [],
    remote: 'any',
    maxCommuteMiles: null,
    minBaseComp: null,
    mustHave: ['TypeScript'],
    dealbreakers: ['Relocation'],
    ...over,
  },
});

const j = (over: Partial<NormalizedJob>): NormalizedJob => ({
  source: 'greenhouse',
  externalId: 'x',
  company: 'A',
  title: 'Senior Software Engineer',
  url: 'u',
  location: 'Remote',
  remote: true,
  description: 'We use Go and Kubernetes',
  postedAt: null,
  raw: {},
  ...over,
});

describe('prefilter', () => {
  it('keeps an engineering role even when must-have keywords are absent (no description gating)', () => {
    const { kept, dropped } = prefilter(
      [j({ description: 'We use Go and Kubernetes' })],
      profile(),
    );
    expect(kept).toHaveLength(1);
    expect(dropped).toHaveLength(0);
  });

  it('does NOT drop on a dealbreaker word appearing (e.g. negated boilerplate)', () => {
    const { kept } = prefilter(
      [j({ description: 'As a remote company we do not offer relocation support.' })],
      profile(),
    );
    expect(kept).toHaveLength(1);
  });

  it('drops a clearly non-engineering title (different job family)', () => {
    const { dropped } = prefilter([j({ title: 'Art Director' })], profile());
    expect(dropped[0].reason).toMatch(/job family/i);
  });

  it('keeps a non-eng-marker title that still has an engineering term', () => {
    const { kept } = prefilter([j({ title: 'Sales Engineer' })], profile());
    expect(kept).toHaveLength(1);
  });

  it('drops a junior title when targeting senior', () => {
    const { dropped } = prefilter([j({ title: 'Junior Software Engineer' })], profile());
    expect(dropped[0].reason).toMatch(/seniority/i);
  });

  it('drops an on-site role when remote-only is required', () => {
    const { dropped } = prefilter(
      [j({ remote: false, location: 'New York, NY' })],
      profile({ remote: 'remote' }),
    );
    expect(dropped[0].reason).toMatch(/remote/i);
  });

  it('keeps unknown/ambiguous titles (conservative)', () => {
    const { kept } = prefilter([j({ title: 'Senior Data Platform Engineer' })], profile());
    expect(kept).toHaveLength(1);
  });

  it('does not let a shared seniority word ("Senior") rescue a different family', () => {
    const { dropped } = prefilter([j({ title: 'Senior Product Designer' })], profile());
    expect(dropped[0].reason).toMatch(/job family/i);
  });
});

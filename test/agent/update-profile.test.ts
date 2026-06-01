import { describe, it, expect } from 'vitest';
import { applyProfileUpdate } from '../../src/agent/tools/update-profile.js';
import type { Profile } from '../../src/profile/schema.js';

const base: Profile = {
  version: 1,
  updatedAt: '',
  basics: { name: 'C', headline: '', yearsExperience: 8, summary: '' },
  skills: { core: ['TS'], familiar: [] },
  experience: [],
  notes: [],
  preferences: {
    targetRoles: [],
    seniority: [],
    locations: [],
    remote: 'any',
    maxCommuteMiles: null,
    minBaseComp: null,
    mustHave: [],
    dealbreakers: [],
  },
};

describe('applyProfileUpdate', () => {
  it('appends a note and sets a preference', () => {
    const next = applyProfileUpdate(base, {
      addNote: 'Prefers async teams',
      setPreferences: { maxCommuteMiles: 30 },
    });
    expect(next.notes).toContain('Prefers async teams');
    expect(next.preferences.maxCommuteMiles).toBe(30);
    expect(next.skills.core).toEqual(['TS']);
  });

  it('adds skills without duplicating', () => {
    const next = applyProfileUpdate(base, { addCoreSkills: ['TS', 'Kafka'] });
    expect(next.skills.core).toEqual(['TS', 'Kafka']);
  });

  it('does not mutate the input profile', () => {
    applyProfileUpdate(base, { addNote: 'x' });
    expect(base.notes).toEqual([]);
  });
});

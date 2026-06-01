import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../../src/config.js';
import { loadProfile, saveProfile, renderProfileMarkdown } from '../../src/profile/store.js';
import type { Profile } from '../../src/profile/schema.js';

const sample: Profile = {
  version: 1,
  updatedAt: '2026-06-01T00:00:00.000Z',
  basics: { name: 'Chris', headline: 'FS Eng', yearsExperience: 8, summary: 'Builds things.' },
  skills: { core: ['TypeScript', 'DynamoDB'], familiar: ['Python'] },
  experience: [
    {
      company: 'Acme',
      title: 'Senior Eng',
      start: '2020-01',
      end: null,
      highlights: ['Led X'],
      tech: ['TS'],
    },
  ],
  preferences: {
    targetRoles: ['Senior FS'],
    seniority: ['senior'],
    locations: ['Remote'],
    remote: 'remote',
    maxCommuteMiles: null,
    minBaseComp: null,
    mustHave: ['TypeScript'],
    dealbreakers: ['PHP'],
  },
  notes: [],
};

describe('profile store', () => {
  it('returns null when no profile exists', () => {
    const cfg = loadConfig(mkdtempSync(path.join(tmpdir(), 'js-')), {});
    expect(loadProfile(cfg)).toBeNull();
  });

  it('round-trips a profile through json', () => {
    const cfg = loadConfig(mkdtempSync(path.join(tmpdir(), 'js-')), {});
    saveProfile(cfg, sample);
    expect(loadProfile(cfg)).toEqual(sample);
  });

  it('writes a human-readable profile.md', () => {
    const cfg = loadConfig(mkdtempSync(path.join(tmpdir(), 'js-')), {});
    saveProfile(cfg, sample);
    const md = readFileSync(cfg.profileMd, 'utf8');
    expect(md).toContain('# Chris');
    expect(md).toContain('DynamoDB');
    expect(md).toContain('Acme');
  });

  it('renderProfileMarkdown is pure and includes preferences', () => {
    expect(renderProfileMarkdown(sample)).toContain('Remote');
    expect(renderProfileMarkdown(sample)).toContain('TypeScript');
  });

  it('throws on an invalid stored profile', () => {
    const cfg = loadConfig(mkdtempSync(path.join(tmpdir(), 'js-')), {});
    saveProfile(cfg, sample);
    writeFileSync(cfg.profileJson, '{"version":1}');
    expect(() => loadProfile(cfg)).toThrow();
  });
});

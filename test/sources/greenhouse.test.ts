import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { greenhouse } from '../../src/sources/greenhouse.js';

describe('greenhouse adapter', () => {
  it('normalizes the board response', async () => {
    const fixture = JSON.parse(
      readFileSync(path.join(__dirname, '../fixtures/greenhouse.json'), 'utf8'),
    );
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => fixture } as Response);
    const jobs = await greenhouse.fetchJobs(
      { source: 'greenhouse', slug: 'acme', name: 'Acme' },
      fetchImpl as unknown as typeof fetch,
    );
    expect(jobs).toHaveLength(1);
    const j = jobs[0];
    expect(j.source).toBe('greenhouse');
    expect(j.externalId).toBe('12345');
    expect(j.company).toBe('Acme');
    expect(j.title).toBe('Senior Software Engineer');
    expect(j.location).toBe('Remote - US');
    expect(j.remote).toBe(true);
    expect(j.description).toContain('TypeScript');
    expect(j.description).not.toContain('<');
  });
});

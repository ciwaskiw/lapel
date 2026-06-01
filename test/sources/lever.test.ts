import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { lever } from '../../src/sources/lever.js';

describe('lever adapter', () => {
  it('normalizes the postings response', async () => {
    const fixture = JSON.parse(
      readFileSync(path.join(__dirname, '../fixtures/lever.json'), 'utf8'),
    );
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => fixture } as Response);
    const jobs = await lever.fetchJobs(
      { source: 'lever', slug: 'acme', name: 'Acme' },
      fetchImpl as unknown as typeof fetch,
    );
    expect(jobs[0].externalId).toBe('abc-123');
    expect(jobs[0].title).toBe('Staff Frontend Engineer');
    expect(jobs[0].remote).toBe(true);
    expect(jobs[0].url).toBe('https://jobs.lever.co/acme/abc-123');
    // createdAt epoch (1716220800000) is converted to an ISO timestamp
    expect(jobs[0].postedAt).toBe(new Date(1716220800000).toISOString());
  });
});

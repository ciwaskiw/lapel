import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ashby } from '../../src/sources/ashby.js';

describe('ashby adapter', () => {
  it('normalizes the job-board response', async () => {
    const fixture = JSON.parse(
      readFileSync(path.join(__dirname, '../fixtures/ashby.json'), 'utf8'),
    );
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => fixture } as Response);
    const jobs = await ashby.fetchJobs(
      { source: 'ashby', slug: 'acme', name: 'Acme' },
      fetchImpl as unknown as typeof fetch,
    );
    expect(jobs).toHaveLength(1);
    const j = jobs[0];
    expect(j.source).toBe('ashby');
    expect(j.externalId).toBe('ash-1');
    expect(j.company).toBe('Acme');
    expect(j.title).toBe('Staff Backend Engineer');
    expect(j.remote).toBe(true);
    expect(j.url).toBe('https://jobs.ashbyhq.com/acme/ash-1');
    expect(j.description).toContain('Go');
  });

  it('POSTs to the ashby posting-api endpoint', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ jobs: [] }) } as Response);
    await ashby.fetchJobs({ source: 'ashby', slug: 'acme' }, fetchImpl as unknown as typeof fetch);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain('posting-api/job-board/acme');
    expect((init as RequestInit).method).toBe('POST');
  });
});

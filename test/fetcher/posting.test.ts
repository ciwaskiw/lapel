import { describe, it, expect, vi } from 'vitest';
import { fetchPostingText, urlToNormalizedJob } from '../../src/fetcher/posting.js';

describe('fetchPostingText', () => {
  it('extracts readable text and a title from html', async () => {
    const html = '<html><head><title>Senior Engineer at Acme</title></head><body><h1>Senior Engineer</h1><p>We use TypeScript.</p></body></html>';
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, text: async () => html } as Response);
    const r = await fetchPostingText('https://acme.example/jobs/1', fetchImpl as unknown as typeof fetch);
    expect(r.title).toContain('Senior Engineer');
    expect(r.text).toContain('TypeScript');
  });

  it('throws on a non-ok response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404 } as Response);
    await expect(fetchPostingText('https://x', fetchImpl as unknown as typeof fetch)).rejects.toThrow(/404/);
  });
});

describe('urlToNormalizedJob', () => {
  it('produces a stable externalId from the url', () => {
    const a = urlToNormalizedJob('https://acme.example/jobs/1', { title: 'T', company: 'Acme', text: 'desc' });
    const b = urlToNormalizedJob('https://acme.example/jobs/1', { title: 'T', company: 'Acme', text: 'desc' });
    expect(a.externalId).toBe(b.externalId);
    expect(a.source).toBe('url');
    expect(a.description).toBe('desc');
  });

  it('defaults company to the url hostname when not provided', () => {
    const j = urlToNormalizedJob('https://jobs.acme.example/1', { text: 'desc' });
    expect(j.company).toBe('jobs.acme.example');
    expect(j.title).toBe('Untitled posting');
  });
});

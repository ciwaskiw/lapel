import { describe, it, expect, vi } from 'vitest';
import { stripHtml, fetchJson } from '../../src/sources/http.js';

describe('stripHtml', () => {
  it('converts html to readable text', () => {
    const out = stripHtml('<p>Hello&nbsp;<b>world</b></p><ul><li>a</li><li>b</li></ul>');
    expect(out).toContain('Hello world');
    expect(out).toContain('a');
    expect(out).not.toContain('<');
  });
});

describe('fetchJson', () => {
  it('retries on failure then succeeds', async () => {
    const f = vi
      .fn()
      .mockRejectedValueOnce(new Error('net'))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: 1 }) } as Response);
    const r = await fetchJson('https://x', {
      retries: 2,
      backoffMs: 1,
      fetchImpl: f as unknown as typeof fetch,
    });
    expect(r).toEqual({ ok: 1 });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('throws the last error after exhausting all retries', async () => {
    const f = vi.fn().mockRejectedValue(new Error('net'));
    await expect(
      fetchJson('https://x', { retries: 3, backoffMs: 1, fetchImpl: f as unknown as typeof fetch }),
    ).rejects.toThrow('net');
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('treats a non-ok response as a failure (and retries)', async () => {
    const f = vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response);
    await expect(
      fetchJson('https://x', { retries: 2, backoffMs: 1, fetchImpl: f as unknown as typeof fetch }),
    ).rejects.toThrow(/HTTP 500/);
    expect(f).toHaveBeenCalledTimes(2);
  });
});

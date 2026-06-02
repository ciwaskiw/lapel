import { describe, it, expect, vi } from 'vitest';
import { parseAtsUrl, slugCandidates, probeAts, resolveLead } from '../../src/leads/resolve.js';

describe('parseAtsUrl', () => {
  it('extracts greenhouse slug from board urls', () => {
    expect(parseAtsUrl('https://job-boards.greenhouse.io/customerio/jobs/7776591')).toEqual({
      source: 'greenhouse',
      slug: 'customerio',
    });
    expect(parseAtsUrl('https://boards.greenhouse.io/figma/jobs/5759501004?gh_jid=1')).toEqual({
      source: 'greenhouse',
      slug: 'figma',
    });
  });
  it('extracts lever and ashby slugs', () => {
    expect(parseAtsUrl('https://jobs.lever.co/netflix/abc-123')).toEqual({
      source: 'lever',
      slug: 'netflix',
    });
    expect(parseAtsUrl('https://jobs.ashbyhq.com/mapbox/uuid-here')).toEqual({
      source: 'ashby',
      slug: 'mapbox',
    });
  });
  it('returns null for non-ATS urls', () => {
    expect(parseAtsUrl('https://zillow.wd5.myworkdayjobs.com/x/job/y')).toBeNull();
    expect(parseAtsUrl('https://seatgeek.com/jobs/7073875')).toBeNull();
  });
});

describe('slugCandidates', () => {
  it('derives lowercase, punctuation-stripped candidates from a name', () => {
    expect(slugCandidates('Customer.io')).toContain('customerio');
    expect(slugCandidates('Grafana Labs')).toEqual(
      expect.arrayContaining(['grafanalabs', 'grafana']),
    );
  });
});

describe('probeAts', () => {
  it('returns true when a board has jobs', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ jobs: [{ id: 1 }] }) } as Response);
    expect(await probeAts('greenhouse', 'customerio', fetchImpl as unknown as typeof fetch)).toBe(
      true,
    );
  });
  it('returns false on 404 / empty', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 404 } as Response);
    expect(await probeAts('greenhouse', 'nope', fetchImpl as unknown as typeof fetch)).toBe(false);
  });
});

describe('resolveLead', () => {
  const prober = (hit: Record<string, true>) => async (source: string, slug: string) =>
    Boolean(hit[`${source}:${slug}`]);

  it('uses a known ATS url → watchlist (drops the redundant url)', async () => {
    const r = await resolveLead(
      {
        company: 'Customer.io',
        urls: ['https://job-boards.greenhouse.io/customerio/jobs/1'],
        notes: '',
      },
      { probe: prober({}) },
    );
    expect(r.watchlist).toEqual({ source: 'greenhouse', slug: 'customerio', name: 'Customer.io' });
    expect(r.addUrls).toEqual([]);
  });
  it('probes by name when no ATS url is given → watchlist', async () => {
    const r = await resolveLead(
      { company: 'Grafana Labs', urls: [], notes: '' },
      { probe: prober({ 'greenhouse:grafanalabs': true }) },
    );
    expect(r.watchlist).toEqual({
      source: 'greenhouse',
      slug: 'grafanalabs',
      name: 'Grafana Labs',
    });
  });
  it('keeps non-ATS posting urls as add-urls', async () => {
    const r = await resolveLead(
      { company: 'SeatGeek', urls: ['https://seatgeek.com/jobs/7073875'], notes: '' },
      { probe: prober({}) },
    );
    expect(r.watchlist).toBeUndefined();
    expect(r.addUrls).toEqual(['https://seatgeek.com/jobs/7073875']);
  });
  it('flags a company with no urls and no probe hit as unresolved', async () => {
    const r = await resolveLead(
      { company: 'Geico', urls: [], notes: 'careers page' },
      { probe: prober({}) },
    );
    expect(r.unresolved).toMatch(/Geico/);
  });
});

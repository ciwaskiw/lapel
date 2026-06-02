import { describe, it, expect, vi } from 'vitest';
import { triageLeads } from '../../src/leads/triage.js';

describe('triageLeads', () => {
  it('splits leads into watchlist, add-urls, and unresolved (deduped)', async () => {
    const extract = vi.fn().mockResolvedValue({
      leads: [
        {
          company: 'Customer.io',
          urls: ['https://job-boards.greenhouse.io/customerio/jobs/1'],
          notes: '',
        },
        { company: 'SeatGeek', urls: ['https://seatgeek.com/jobs/7073875'], notes: '' },
        { company: 'Grafana', urls: [], notes: '' },
        { company: 'Geico', urls: [], notes: 'careers page' },
        {
          company: 'Customer.io',
          urls: ['https://job-boards.greenhouse.io/customerio/jobs/2'],
          notes: '',
        },
      ],
    });
    const probe = async (s: string, slug: string) => s === 'greenhouse' && slug === 'grafana';
    const r = await triageLeads('…', { extract, probe });
    expect(r.watchlist).toEqual([
      { source: 'greenhouse', slug: 'customerio', name: 'Customer.io' },
      { source: 'greenhouse', slug: 'grafana', name: 'Grafana' },
    ]);
    expect(r.addUrls).toEqual(['https://seatgeek.com/jobs/7073875']);
    expect(r.unresolved[0]).toMatch(/Geico/);
  });
});

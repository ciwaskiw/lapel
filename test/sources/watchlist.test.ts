import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mergeWatchlist, loadWatchlist } from '../../src/sources/index.js';

describe('mergeWatchlist', () => {
  it('creates the file and adds entries', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'wl-')), 'companies.yaml');
    const { added } = mergeWatchlist(file, [
      { source: 'greenhouse', slug: 'customerio', name: 'Customer.io' },
      { source: 'ashby', slug: 'mapbox', name: 'Mapbox' },
    ]);
    expect(added).toBe(2);
    expect(
      loadWatchlist(file)
        .map((e) => e.slug)
        .sort(),
    ).toEqual(['customerio', 'mapbox']);
  });

  it('dedups against existing entries by source:slug', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'wl-')), 'companies.yaml');
    mergeWatchlist(file, [{ source: 'greenhouse', slug: 'customerio', name: 'Customer.io' }]);
    const { added } = mergeWatchlist(file, [
      { source: 'greenhouse', slug: 'customerio', name: 'Customer.io' }, // dup
      { source: 'greenhouse', slug: 'launchdarkly', name: 'LaunchDarkly' }, // new
    ]);
    expect(added).toBe(1);
    expect(loadWatchlist(file)).toHaveLength(2);
  });
});

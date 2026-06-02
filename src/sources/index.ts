import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parse, stringify } from 'yaml';
import { greenhouse } from './greenhouse.js';
import { lever } from './lever.js';
import { ashby } from './ashby.js';
import type { SourceAdapter, WatchlistEntry } from './types.js';

export const adapters: Record<WatchlistEntry['source'], SourceAdapter> = {
  greenhouse,
  lever,
  ashby,
};

export function loadWatchlist(file: string): WatchlistEntry[] {
  const doc = parse(readFileSync(file, 'utf8')) as { companies?: WatchlistEntry[] };
  return doc.companies ?? [];
}

export function mergeWatchlist(file: string, entries: WatchlistEntry[]): { added: number } {
  const existing = existsSync(file) ? loadWatchlist(file) : [];
  const seen = new Set(existing.map((e) => `${e.source}:${e.slug}`));
  let added = 0;
  for (const e of entries) {
    const key = `${e.source}:${e.slug}`;
    if (!seen.has(key)) {
      seen.add(key);
      existing.push(e);
      added++;
    }
  }
  writeFileSync(file, stringify({ companies: existing }));
  return { added };
}

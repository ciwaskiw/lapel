import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
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

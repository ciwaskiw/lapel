import { readFileSync, appendFileSync, existsSync } from 'node:fs';
import type { Config } from '../config.js';
import { createBackend } from '../agent/backend.js';
import { extractLeads } from '../leads/extract.js';
import { triageLeads } from '../leads/triage.js';
import { mergeWatchlist } from '../sources/index.js';

const ADDS_FILE = 'leads-urls.txt';

export async function runLeads(
  cfg: Config,
  file: string,
  opts: { dryRun?: boolean },
): Promise<void> {
  const text = readFileSync(file, 'utf8');
  const backend = createBackend(cfg);
  const result = await triageLeads(text, {
    extract: (t) => extractLeads(backend, cfg.models.worker, t),
  });

  console.log(`\nWatchlist (${result.watchlist.length}) → ${cfg.companiesFile}`);
  for (const e of result.watchlist) console.log(`  ${e.source}/${e.slug}  (${e.name})`);
  console.log(`\nDirect-add URLs (${result.addUrls.length}) → ${ADDS_FILE}`);
  for (const u of result.addUrls) console.log(`  ${u}`);
  if (result.unresolved.length) {
    console.log(`\nUnresolved (needs a posting URL or manual ATS lookup):`);
    for (const u of result.unresolved) console.log(`  - ${u}`);
  }
  if (opts.dryRun) {
    console.log('\n(--dry-run: nothing written)');
    return;
  }

  const { added } = mergeWatchlist(cfg.companiesFile, result.watchlist);
  const have = existsSync(ADDS_FILE)
    ? new Set(
        readFileSync(ADDS_FILE, 'utf8')
          .split('\n')
          .map((s) => s.trim()),
      )
    : new Set<string>();
  const fresh = result.addUrls.filter((u) => !have.has(u));
  if (fresh.length) appendFileSync(ADDS_FILE, fresh.join('\n') + '\n');
  console.log(`\nWrote: +${added} watchlist companies, +${fresh.length} add-urls (${ADDS_FILE}).`);
}

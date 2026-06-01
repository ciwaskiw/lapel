import type Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function migrate(db: Database.Database): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const sql = readFileSync(path.join(here, 'schema.sql'), 'utf8');
  db.exec(sql);
}

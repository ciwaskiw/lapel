import type Database from 'better-sqlite3';
import { removeJobsByCompany, removeJobById } from '../db/index.js';

export function runRemove(db: Database.Database, opts: { company?: string; id?: number }): string {
  if (opts.id != null && opts.company) {
    throw new Error('Pass either a <company> or --id, not both.');
  }
  if (opts.id != null) {
    return removeJobById(db, opts.id) ? `Removed job ${opts.id}.` : `No job with id ${opts.id}.`;
  }
  if (opts.company) {
    const n = removeJobsByCompany(db, opts.company);
    return `Removed ${n} job(s) for "${opts.company}".`;
  }
  throw new Error('Provide a <company> or --id <job-id>.');
}

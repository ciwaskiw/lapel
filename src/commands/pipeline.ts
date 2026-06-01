import type Database from 'better-sqlite3';
import { getJobs, getJobById, setStatus, type JobStatus } from '../db/index.js';
import { formatTable } from '../ui/table.js';

const STATUSES: JobStatus[] = ['new', 'interested', 'applied', 'rejected'];

export function renderPipeline(
  db: Database.Database,
  filter: { status?: JobStatus; minScore?: number } = {},
): string {
  const rows = getJobs(db, filter);
  return formatTable(
    ['ID', 'Score', 'Status', 'Title', 'Company', 'Location'],
    rows.map((r) => [String(r.id), r.score == null ? '—' : String(r.score), r.status, r.title, r.company, r.location ?? '']),
  );
}

export function changeStatus(db: Database.Database, id: number, status: JobStatus): boolean {
  if (!STATUSES.includes(status)) throw new Error(`Invalid status "${status}". Use one of: ${STATUSES.join(', ')}`);
  if (!getJobById(db, id)) throw new Error(`No job with id ${id}.`);
  return setStatus(db, id, status);
}

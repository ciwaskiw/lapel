import type Database from 'better-sqlite3';
import type { PrepTurn } from './session.js';

export interface PrepSessionRow {
  id: number;
  job_id: number;
  round_context: string | null;
  transcript_json: string;
  created_at: string;
  updated_at: string;
}

/** Load the rolling prep transcript for a pipeline job, or null if none has been saved. */
export function loadPrepSession(db: Database.Database, jobId: number): PrepTurn[] | null {
  const row = db
    .prepare('SELECT transcript_json FROM prep_sessions WHERE job_id = ?')
    .get(jobId) as { transcript_json: string } | undefined;
  return row ? (JSON.parse(row.transcript_json) as PrepTurn[]) : null;
}

/** Upsert the rolling prep session for a job (one row per job_id). */
export function savePrepSession(
  db: Database.Database,
  jobId: number,
  transcript: PrepTurn[],
): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO prep_sessions (job_id, transcript_json, created_at, updated_at)
     VALUES (@jobId, @json, @now, @now)
     ON CONFLICT(job_id) DO UPDATE SET
       transcript_json = excluded.transcript_json,
       updated_at      = excluded.updated_at`,
  ).run({ jobId, json: JSON.stringify(transcript), now });
}

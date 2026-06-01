import Database from 'better-sqlite3';
import type { NormalizedJob } from '../sources/types.js';
export { migrate } from './migrate.js';

export type JobStatus = 'new' | 'interested' | 'applied' | 'rejected';

export interface JobScoreFields {
  score: number;
  matchedSkills: string[];
  missingSkills: string[];
  reasons: string;
}

export interface JobRow {
  id: number; source: string; external_id: string; company: string; title: string;
  url: string; location: string | null; remote: number | null; description: string;
  score: number | null; matched_skills: string | null; missing_skills: string | null;
  score_reasons: string | null; status: JobStatus; posted_at: string | null;
  first_seen: string; raw_json: string;
}

export interface ApplicationRow {
  id: number; job_id: number; resume_path: string; cover_path: string;
  fit_notes_path: string; created_at: string;
}

export function openDb(file: string): Database.Database {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  return db;
}

export function upsertJob(
  db: Database.Database,
  job: NormalizedJob,
  score?: JobScoreFields,
): { id: number; inserted: boolean } {
  const existing = db
    .prepare('SELECT id FROM jobs WHERE source = ? AND external_id = ?')
    .get(job.source, job.externalId) as { id: number } | undefined;

  const common = {
    company: job.company, title: job.title, url: job.url, location: job.location,
    remote: job.remote === null ? null : job.remote ? 1 : 0, description: job.description,
    posted_at: job.postedAt, raw_json: JSON.stringify(job.raw),
    score: score?.score ?? null,
    matched_skills: score ? JSON.stringify(score.matchedSkills) : null,
    missing_skills: score ? JSON.stringify(score.missingSkills) : null,
    score_reasons: score?.reasons ?? null,
  };

  if (existing) {
    db.prepare(
      `UPDATE jobs SET company=@company, title=@title, url=@url, location=@location,
        remote=@remote, description=@description, posted_at=@posted_at, raw_json=@raw_json,
        score=COALESCE(@score, score), matched_skills=COALESCE(@matched_skills, matched_skills),
        missing_skills=COALESCE(@missing_skills, missing_skills),
        score_reasons=COALESCE(@score_reasons, score_reasons)
       WHERE id=@id`,
    ).run({ ...common, id: existing.id });
    return { id: existing.id, inserted: false };
  }

  const info = db.prepare(
    `INSERT INTO jobs (source, external_id, company, title, url, location, remote, description,
        score, matched_skills, missing_skills, score_reasons, status, posted_at, first_seen, raw_json)
     VALUES (@source, @external_id, @company, @title, @url, @location, @remote, @description,
        @score, @matched_skills, @missing_skills, @score_reasons, 'new', @posted_at, @first_seen, @raw_json)`,
  ).run({ ...common, source: job.source, external_id: job.externalId, first_seen: new Date().toISOString() });
  return { id: Number(info.lastInsertRowid), inserted: true };
}

export function getJobs(
  db: Database.Database,
  filter: { status?: JobStatus; minScore?: number; limit?: number } = {},
): JobRow[] {
  const clauses: string[] = [];
  const params: Record<string, unknown> = {};
  if (filter.status) { clauses.push('status = @status'); params.status = filter.status; }
  if (filter.minScore != null) { clauses.push('score >= @minScore'); params.minScore = filter.minScore; }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = filter.limit ? 'LIMIT @limit' : '';
  if (filter.limit) params.limit = filter.limit;
  return db
    .prepare(`SELECT * FROM jobs ${where} ORDER BY score DESC NULLS LAST, first_seen DESC ${limit}`)
    .all(params) as JobRow[];
}

export function getJobById(db: Database.Database, id: number): JobRow | undefined {
  return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined;
}

export function existingKeys(db: Database.Database): { ids: Set<string>; urls: Set<string> } {
  const rows = db.prepare('SELECT source, external_id, url FROM jobs').all() as {
    source: string; external_id: string; url: string;
  }[];
  return {
    ids: new Set(rows.map((r) => `${r.source}:${r.external_id}`)),
    urls: new Set(rows.map((r) => r.url)),
  };
}

export function setStatus(db: Database.Database, id: number, status: JobStatus): boolean {
  return db.prepare('UPDATE jobs SET status = ? WHERE id = ?').run(status, id).changes > 0;
}

export function insertApplication(
  db: Database.Database,
  a: { jobId: number; resumePath: string; coverPath: string; fitNotesPath: string },
): void {
  db.prepare(
    `INSERT INTO applications (job_id, resume_path, cover_path, fit_notes_path, created_at)
     VALUES (@jobId, @resumePath, @coverPath, @fitNotesPath, @createdAt)
     ON CONFLICT(job_id) DO UPDATE SET resume_path=excluded.resume_path,
       cover_path=excluded.cover_path, fit_notes_path=excluded.fit_notes_path,
       created_at=excluded.created_at`,
  ).run({ ...a, createdAt: new Date().toISOString() });
}

export function getApplication(db: Database.Database, jobId: number): ApplicationRow | undefined {
  return db.prepare('SELECT * FROM applications WHERE job_id = ?').get(jobId) as ApplicationRow | undefined;
}

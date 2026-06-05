import { describe, it, expect, beforeEach } from 'vitest';
import { openDb, migrate } from '../../src/db/index.js';
import { loadPrepSession, savePrepSession } from '../../src/prep/store.js';
import type { PrepTurn } from '../../src/prep/session.js';

const turns: PrepTurn[] = [
  { role: 'coach', text: 'Tell me about the round.' },
  { role: 'candidate', text: 'Behavioral with the hiring manager.' },
];

function insertJob(db: ReturnType<typeof openDb>, id: number): void {
  db.prepare(
    `INSERT INTO jobs (id, source, external_id, company, title, url, description, status, first_seen, raw_json)
     VALUES (?, 'test', ?, 'Acme', 'Engineer', 'https://example.com/' || ?, 'desc', 'new', '2024-01-01', '{}')`,
  ).run(id, String(id), String(id));
}

describe('prep store', () => {
  let db: ReturnType<typeof openDb>;
  beforeEach(() => {
    db = openDb(':memory:');
    migrate(db);
    insertJob(db, 1);
    insertJob(db, 2);
  });

  it('returns null when no session exists for a job', () => {
    expect(loadPrepSession(db, 1)).toBeNull();
  });

  it('round-trips a saved transcript', () => {
    savePrepSession(db, 1, turns);
    expect(loadPrepSession(db, 1)).toEqual(turns);
  });

  it('upserts: a second save replaces the same job row', () => {
    savePrepSession(db, 1, turns);
    const more: PrepTurn[] = [...turns, { role: 'coach', text: 'Great, let us drill that.' }];
    savePrepSession(db, 1, more);
    expect(loadPrepSession(db, 1)).toEqual(more);
    const count = db.prepare('SELECT COUNT(*) AS n FROM prep_sessions WHERE job_id = 1').get() as {
      n: number;
    };
    expect(count.n).toBe(1);
  });

  it('isolates sessions per job_id', () => {
    savePrepSession(db, 1, turns);
    savePrepSession(db, 2, [{ role: 'coach', text: 'Different job.' }]);
    expect(loadPrepSession(db, 1)).toEqual(turns);
    expect(loadPrepSession(db, 2)).toEqual([{ role: 'coach', text: 'Different job.' }]);
  });
});

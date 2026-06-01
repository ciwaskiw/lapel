CREATE TABLE IF NOT EXISTS jobs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source        TEXT NOT NULL,
  external_id   TEXT NOT NULL,
  company       TEXT NOT NULL,
  title         TEXT NOT NULL,
  url           TEXT NOT NULL,
  location      TEXT,
  remote        INTEGER,
  description   TEXT NOT NULL,
  score         INTEGER,
  matched_skills TEXT,
  missing_skills TEXT,
  score_reasons TEXT,
  status        TEXT NOT NULL DEFAULT 'new',
  posted_at     TEXT,
  first_seen    TEXT NOT NULL,
  raw_json      TEXT NOT NULL,
  UNIQUE(source, external_id)
);

CREATE TABLE IF NOT EXISTS applications (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id          INTEGER NOT NULL REFERENCES jobs(id),
  resume_path     TEXT NOT NULL,
  cover_path      TEXT NOT NULL,
  fit_notes_path  TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  UNIQUE(job_id)
);

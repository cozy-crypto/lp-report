CREATE TABLE IF NOT EXISTS waitlist (
  contact    TEXT PRIMARY KEY,         -- email, or @handle when no email
  email      TEXT,
  x          TEXT,
  role       TEXT NOT NULL CHECK (role IN ('copy', 'lead', 'curious')),
  wallet     TEXT,
  fees_kept  REAL,                     -- share of fees kept, 0.32 = 32%
  fees_usd   REAL,
  created_at TEXT NOT NULL
);

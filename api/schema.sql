CREATE TABLE IF NOT EXISTS waitlist (
  contact    TEXT PRIMARY KEY,         -- email, or @handle when no email
  email      TEXT,
  x          TEXT,
  role       TEXT NOT NULL CHECK (role IN ('copy', 'lead', 'curious')),
  wallet     TEXT,
  fees_kept  REAL,                     -- share of fees kept, 0.32 = 32%
  fees_usd   REAL,
  deposited_usd REAL,
  created_at TEXT NOT NULL
);

-- Funnel: visit → check → share → signup. No IPs or cookies; checked wallets are hashed.
CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('visit', 'check', 'share', 'signup')),
  wallet_hash TEXT,
  fees_kept   REAL,
  fees_usd    REAL,
  pools       INTEGER,
  ref         TEXT,                    -- where the visit came from: a card id or "x"
  meta        TEXT,                    -- JSON extras: visit {from, mobile, lang}; check {positions, depositedUsd, ms, own, error…}
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_type_time ON events (type, created_at);

-- Receipt images behind share links, so X shows the card under a posted link.
CREATE TABLE IF NOT EXISTS cards (
  id         TEXT PRIMARY KEY,
  wallet     TEXT NOT NULL,
  fees_kept  REAL,
  lp_usd     REAL,
  png        BLOB NOT NULL,
  created_at TEXT NOT NULL
);

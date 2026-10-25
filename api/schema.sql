CREATE TABLE IF NOT EXISTS waitlist (
  contact    TEXT PRIMARY KEY,         -- email, or @handle when no email
  email      TEXT,
  x          TEXT,
  role       TEXT NOT NULL CHECK (role IN ('copy', 'lead', 'curious')),
  wallet     TEXT,
  fees_kept  REAL,                     -- share of fees kept, 0.32 = 32%
  fees_usd   REAL,
  deposited_usd REAL,
  code       TEXT UNIQUE,              -- own referral code: shouldaheld.com/?j=<code>
  referred_by TEXT,                    -- code of whoever brought them
  created_at TEXT NOT NULL
);

-- Funnel: visit → check → share → preview (a platform fetched the card: the link was posted) → click → signup.
-- Other types: action (button presses on the site). No IPs or cookies; checked wallets are hashed.
-- Allowed types live in worker.js. Changes to an existing database go in migrations/.
CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY,
  type        TEXT NOT NULL,
  wallet_hash TEXT,
  fees_kept   REAL,
  fees_usd    REAL,
  pools       INTEGER,
  ref         TEXT,                    -- share card id the event belongs to
  meta        TEXT,                    -- JSON extras: visit {from, mobile, lang}; check {positions, depositedUsd, ms, own, error…}
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_type_time ON events (type, created_at);
CREATE INDEX IF NOT EXISTS events_ref ON events (ref);

-- Receipt images behind share links, so X shows the card under a posted link.
CREATE TABLE IF NOT EXISTS cards (
  id         TEXT PRIMARY KEY,
  wallet     TEXT NOT NULL,
  fees_kept  REAL,
  lp_usd     REAL,
  png        BLOB NOT NULL,
  created_at TEXT NOT NULL
);

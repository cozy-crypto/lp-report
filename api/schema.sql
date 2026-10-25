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
-- Daily crawl history: keep every daily crawl, not just today's leaderboard file: history per wallet for picking
-- consistent LPs (phase 1) and for the farm ("third week in the top 10").
CREATE TABLE crawl_runs (
  date        TEXT PRIMARY KEY,          -- UTC day of the run, YYYY-MM-DD
  pools       INTEGER, wallets_found INTEGER, crawled INTEGER, ranked INTEGER, skipped INTEGER, failed INTEGER,
  seconds     INTEGER,
  updated_at  TEXT NOT NULL
);
CREATE TABLE wallet_days (
  date        TEXT NOT NULL,
  wallet      TEXT NOT NULL,
  status      TEXT NOT NULL,             -- ok | skipped (too many pools) | failed
  ranked      INTEGER NOT NULL DEFAULT 0, -- made it onto the public leaderboard that day
  rank        INTEGER,                   -- place by fees kept among ranked wallets
  fees_kept   REAL, fees_usd REAL, lp_usd REAL, pnl_usd REAL, deposited_usd REAL,
  pools       INTEGER, positions INTEGER, open_positions INTEGER,
  rows        TEXT,                      -- JSON per pool: [{a: address, n: name, k, lp, f: fees, d: deposited, o: open}]
  error       TEXT,
  PRIMARY KEY (date, wallet)
);
CREATE INDEX wallet_days_wallet ON wallet_days (wallet, date);

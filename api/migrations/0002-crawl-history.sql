-- 2026-10-26: keep every daily crawl, not just today's leaderboard file: history per wallet for picking
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

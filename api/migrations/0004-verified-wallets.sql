-- 2026-10-26: wallets whose owner proved it by signing a message on the site (no transaction).
CREATE TABLE verified_wallets (
  wallet      TEXT PRIMARY KEY,
  verified_at TEXT NOT NULL,
  meta        TEXT                       -- JSON: {wallet app, country}
);

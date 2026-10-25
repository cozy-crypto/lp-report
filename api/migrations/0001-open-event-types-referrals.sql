-- 2026-10-26: event types are validated in the Worker now (new: preview, click, action), waitlist gets referral codes.
CREATE TABLE events_new (
  id INTEGER PRIMARY KEY, type TEXT NOT NULL, wallet_hash TEXT, fees_kept REAL, fees_usd REAL,
  pools INTEGER, ref TEXT, meta TEXT, created_at TEXT NOT NULL
);
INSERT INTO events_new SELECT id, type, wallet_hash, fees_kept, fees_usd, pools, ref, meta, created_at FROM events;
DROP TABLE events;
ALTER TABLE events_new RENAME TO events;
CREATE INDEX events_type_time ON events (type, created_at);
CREATE INDEX events_ref ON events (ref);

ALTER TABLE waitlist ADD COLUMN code TEXT;
ALTER TABLE waitlist ADD COLUMN referred_by TEXT;
CREATE UNIQUE INDEX waitlist_code ON waitlist (code);

-- 2026-10-26: whether the person said the checked wallet is theirs (self-declared, not verified).
ALTER TABLE waitlist ADD COLUMN owns_wallet INTEGER NOT NULL DEFAULT 0;

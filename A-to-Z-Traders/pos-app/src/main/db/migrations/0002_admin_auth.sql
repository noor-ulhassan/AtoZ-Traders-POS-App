-- ============================================================================
-- 0002_admin_auth — the single admin credential that locks the whole app
--
--   * There is exactly one admin (single-owner shop), so this mirrors the
--     `settings` table: one row pinned to id = 1 by a CHECK.
--   * The row is NOT seeded. Its absence is the "not configured yet" signal the
--     first-run setup screen keys off — the owner picks the password on launch.
--   * Only hashes are stored. Password and the security answer are hashed with
--     scrypt (see utils/password.ts); the plain text never touches the disk.
-- ============================================================================

CREATE TABLE admin_credential (
  id                   INTEGER PRIMARY KEY CHECK (id = 1),
  password_hash        TEXT NOT NULL,
  password_salt        TEXT NOT NULL,
  security_question    TEXT NOT NULL,
  security_answer_hash TEXT NOT NULL,
  security_answer_salt TEXT NOT NULL,
  failed_attempts      INTEGER NOT NULL DEFAULT 0,   -- consecutive failed logins
  locked_until         TEXT,                         -- timestamp; NULL = not locked
  created_at           TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

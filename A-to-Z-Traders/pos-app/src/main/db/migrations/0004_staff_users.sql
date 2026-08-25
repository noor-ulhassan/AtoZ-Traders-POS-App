-- ============================================================================
-- 0004_staff_users — additional staff accounts with a limited role
--
--   * The owner keeps signing in through `admin_credential` (0002); this table
--     is only for extra, non-admin staff. It is empty until the admin adds
--     someone, so existing installs behave exactly as before.
--   * Only a scrypt hash of the PIN is stored — the plain PIN never touches
--     disk, same as the admin password (see utils/password.ts).
--   * A 4-digit PIN is a small guessing space, so per-user attempt lockout is
--     recorded here just as it is for the admin credential.
--   * `role` is CHECK-constrained; 'admin' is intentionally NOT allowed here so
--     a second full-access account can never be minted through staff management.
-- ============================================================================

CREATE TABLE staff_users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  username        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pin_hash        TEXT NOT NULL,
  pin_salt        TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'shopkeeper' CHECK (role IN ('shopkeeper')),
  is_active       INTEGER NOT NULL DEFAULT 1,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    TEXT,
  last_login_at   TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX idx_staff_users_username ON staff_users(username);

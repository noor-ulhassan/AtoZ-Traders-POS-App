-- ============================================================================
-- 0010_mobile_access — the shop phone as a companion to the till
--
-- The client wants to work from his phone on the shop's own Wi-Fi: read the
-- khata, take a payment, adjust stock, write a bill. The way NOT to do that is
-- a second program with its own copy of the database — two writers on one
-- SQLite file, two ideas of stock, two invoice counters. So the phone is not a
-- second POS: it is a second SCREEN onto this one. The app already running on
-- the counter serves it, over the LAN, from the same connection and the same
-- services.
--
-- Only two things about that belong on disk, and they are both settings:
--
--   * `mobile_enabled` — OFF by default, and it must stay off by default. This
--     opens a port on the shop network; that is the owner's decision to make
--     deliberately, once, not something an upgrade turns on for him.
--
--   * `mobile_port` — which port to listen on. Configurable because a shop
--     machine may already have something on any given number, and a port
--     clash must be fixable from the Settings screen rather than by a rebuild.
--
-- Everything else the feature needs is deliberately NOT here:
--
--   * Sessions are in-memory, exactly like the desktop's own lock (see
--     `auth/session.ts`). Closing the app signs every phone out. A token that
--     survived a restart would be a password that never expires, written in
--     clear text, in the shop's backup, forever.
--
--   * There is no mobile user table. The phone signs in with the admin
--     password that already exists, and gets the admin's access — no second
--     credential to keep in step, and no second thing to forget.
-- ============================================================================

-- 0 = the phone cannot connect at all, and no port is opened.
ALTER TABLE settings ADD COLUMN mobile_enabled INTEGER NOT NULL DEFAULT 0;

-- 8420: high enough to be free on a shop PC, and not a port a browser blocks.
ALTER TABLE settings ADD COLUMN mobile_port INTEGER NOT NULL DEFAULT 8420;

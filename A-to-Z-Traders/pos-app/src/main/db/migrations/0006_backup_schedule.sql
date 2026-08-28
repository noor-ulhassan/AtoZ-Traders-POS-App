-- ============================================================================
-- 0006_backup_schedule — how often the app copies itself somewhere safe
--
--   * `auto_backup_dir` already existed and already means "'' = off". This adds
--     only the cadence, so an install that had a folder configured keeps it and
--     simply starts backing up on a timer instead of solely on close.
--   * 15 minutes is the default because the thing being protected is a day of
--     billing on a shop machine that may lose power. A backup that only runs on
--     a clean quit protects nothing against the case it exists for.
--   * 0 means "only when the app closes" — the old behaviour, kept reachable
--     for anyone who wants it.
-- ============================================================================

ALTER TABLE settings ADD COLUMN backup_interval_minutes INTEGER NOT NULL DEFAULT 15;

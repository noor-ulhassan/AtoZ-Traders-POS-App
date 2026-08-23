-- ============================================================================
-- 0003_business_profile — extend the business profile with contact channels
--
-- Adds email and website to the single settings row so the whole business
-- profile (name, address, phone, email, website, tax) can be edited by the
-- admin and shown in the app footer. Existing rows default to '' — same
-- convention as every other optional text column in 0001.
-- ============================================================================

ALTER TABLE settings ADD COLUMN email   TEXT NOT NULL DEFAULT '';
ALTER TABLE settings ADD COLUMN website TEXT NOT NULL DEFAULT '';

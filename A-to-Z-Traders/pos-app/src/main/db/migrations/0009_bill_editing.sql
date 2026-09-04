-- ============================================================================
-- 0009_bill_editing — settling, editing and voiding a bill after it is issued
--
-- The client's fourth request: "he will generate the bill, deliver the product,
-- and if he then finds out the customer will pay half or full or nothing, he
-- should be able to edit this bill and all the data throughout the app and the
-- database must update with it."
--
-- Two things are needed on disk for that, and only two:
--
--   * `sales.voided_at` — a cancelled bill keeps its invoice number (it was
--     printed and handed over; the number must never be reused) but is emptied
--     of every figure, so no report has to learn a new filter to stay right.
--     Only the two *count* aggregates read this column; every money aggregate
--     sums zeroes and needs no change at all.
--
--   * `sale_revisions` — a JSON snapshot of the bill as it stood BEFORE each
--     change, with who made it and when. One insert per edit. It makes an edit
--     non-destructive, gives the owner a visible history on the bill, and is
--     the only record of what an old bill used to say once it is rewritten.
--
-- Everything else the feature needs already exists: the khata is derived from
-- sales, so correcting a bill corrects every statement; stock movements are
-- addressable by (ref_table, ref_id), so one bill's movements can be reversed
-- as a set; and `cost_price` is frozen on the line, so re-saving a bill cannot
-- restate an old month's profit.
-- ============================================================================

-- NULL for a live bill; the moment of cancellation for a void one.
ALTER TABLE sales ADD COLUMN voided_at TEXT;

CREATE TABLE sale_revisions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id    INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  -- 1 for the first change to a bill, counting up. Not the sale's id.
  revision   INTEGER NOT NULL,
  action     TEXT NOT NULL CHECK (action IN ('settle', 'edit', 'void')),
  -- The staff username, or 'owner' for the admin. The session is the only
  -- place identity exists in this app; it is copied here so the history still
  -- reads correctly after that staff account is deleted.
  changed_by TEXT NOT NULL DEFAULT 'owner',
  reason     TEXT,
  -- The whole bill, header and lines, as it was before this change (JSON).
  snapshot   TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE INDEX idx_sale_revisions_sale ON sale_revisions(sale_id, revision);

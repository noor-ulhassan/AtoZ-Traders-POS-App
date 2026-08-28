-- ============================================================================
-- 0007_other_stock — goods the shop sells but does not own
--
-- Consignment: stock that belongs to someone else, sold on their behalf. It has
-- to be billable and countable, but the margin on it is not the shop's, so it
-- must never reach a cost, profit or stock-value figure.
--
-- The isolation is done by stamping the fact onto the LINE at the moment of
-- sale (`sale_items.is_other`) rather than by joining back to `products` in
-- every report. Two reasons, both learned from `cost_price`, which is frozen
-- onto the line for exactly the same purpose:
--
--   * a report filters one column on the table it is already reading, with no
--     extra join — so there is one obvious place to get it right, not fifteen;
--   * reclassifying a product later cannot rewrite what its old bills earned.
--
-- Bill-level totals carry the same split (`sales.other_subtotal`) so the P&L
-- can subtract the consignment portion without touching `sale_items` at all.
-- ============================================================================

-- ---------- products ----------
ALTER TABLE products ADD COLUMN ownership TEXT NOT NULL DEFAULT 'own'
  CHECK (ownership IN ('own', 'other'));

-- Who the goods belong to. '' for the shop's own stock.
ALTER TABLE products ADD COLUMN owner_name TEXT NOT NULL DEFAULT '';

CREATE INDEX idx_products_ownership ON products(ownership);

-- ---------- sales ----------
-- The part of `subtotal` that came from other-stock lines. Everything the P&L
-- treats as revenue is `subtotal - other_subtotal`.
ALTER TABLE sales ADD COLUMN other_subtotal REAL NOT NULL DEFAULT 0;

-- Frozen at sale time, exactly like cost_price beside it.
ALTER TABLE sale_items ADD COLUMN is_other INTEGER NOT NULL DEFAULT 0;

CREATE INDEX idx_sale_items_is_other ON sale_items(is_other);

-- ---------- returns ----------
ALTER TABLE sale_returns ADD COLUMN other_total REAL NOT NULL DEFAULT 0;
ALTER TABLE sale_return_items ADD COLUMN is_other INTEGER NOT NULL DEFAULT 0;

-- ---------- stock movements ----------
-- Two new reasons are needed: goods arriving from their owner, and unsold goods
-- going back. Neither is a purchase — no money moves and no supplier balance is
-- touched — so they cannot borrow 'purchase', and calling them 'adjustment'
-- would hide them among genuine corrections.
--
-- SQLite cannot widen a CHECK constraint in place, so the table is rebuilt. The
-- migration runner wraps this in a transaction; nothing references
-- stock_movements, so dropping and renaming is safe. Its indexes go with the
-- old table and are recreated below.

CREATE TABLE stock_movements_new (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  change_qty REAL NOT NULL,
  reason     TEXT NOT NULL CHECK (reason IN
             ('opening','purchase','sale','sale_return','purchase_return','adjustment',
              'other_in','other_out')),
  ref_table  TEXT,
  ref_id     INTEGER,
  cost_price REAL,
  date       TEXT NOT NULL DEFAULT (date('now','localtime')),
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

INSERT INTO stock_movements_new
  (id, product_id, change_qty, reason, ref_table, ref_id, cost_price, date, notes, created_at)
SELECT
   id, product_id, change_qty, reason, ref_table, ref_id, cost_price, date, notes, created_at
  FROM stock_movements;

DROP TABLE stock_movements;
ALTER TABLE stock_movements_new RENAME TO stock_movements;

CREATE INDEX idx_movements_product ON stock_movements(product_id);
CREATE INDEX idx_movements_date    ON stock_movements(date);
CREATE INDEX idx_movements_ref     ON stock_movements(ref_table, ref_id);

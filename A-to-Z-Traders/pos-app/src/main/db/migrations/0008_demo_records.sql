-- ============================================================================
-- 0008_demo_records — a manifest of everything the demo seeder created
--
-- The shop's real data and sample data have to live in the same database, and
-- removing the samples afterwards must take the samples and nothing else. A
-- flag column on every table would mean touching a dozen schemas; a "wipe
-- everything" button would be one misclick away from a disaster.
--
-- So the seeder writes a receipt. Every row it creates is listed here, and the
-- remover walks the list backwards. Anything absent from it is the shop's own
-- and is never touched — which also means the seeder can be run on a database
-- that is already in real use.
--
-- Only the parent rows are listed. Children with ON DELETE CASCADE
-- (sale_items, purchase_items, return items, product_units,
-- customer_item_prices) go with their parent, and stock movements are removed
-- by product, since every movement of a demo product is by definition a demo
-- movement.
-- ============================================================================

CREATE TABLE demo_records (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name TEXT NOT NULL,
  row_id     INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE (table_name, row_id)
);

CREATE INDEX idx_demo_records_table ON demo_records(table_name);

-- ============================================================================
-- 0005_product_barcode_unique — one barcode, one product
--
--   * `findProductByBarcode` reads a single row. With two products sharing a
--     barcode it returned an arbitrary one of them, so a scan at the counter
--     could quietly bill the wrong item. The larger the catalogue, the more
--     likely that collision becomes — this closes it at the schema.
--   * Blank barcodes are normalised to NULL first. The app already treats ''
--     and NULL alike, but a unique index does not: several '' rows would
--     collide, while several NULLs are always allowed in SQLite.
--   * Existing duplicates are resolved rather than allowed to fail the
--     migration. A failing migration aborts startup, and refusing to open the
--     app over an ambiguity that has been harmless until now would be the
--     worse outcome. The lowest id keeps the barcode; the others have theirs
--     cleared, which loses nothing that was reliable to begin with — the scan
--     was already returning an arbitrary one of them. The products themselves
--     are untouched and the owner can re-enter the barcode on whichever one
--     should own it.
-- ============================================================================

UPDATE products SET barcode = NULL
 WHERE barcode IS NOT NULL AND TRIM(barcode) = '';

UPDATE products SET barcode = NULL
 WHERE barcode IS NOT NULL
   AND id NOT IN (
     SELECT MIN(id) FROM products WHERE barcode IS NOT NULL GROUP BY barcode
   );

-- Replace the plain lookup index with a unique one. Partial, so the many
-- products that legitimately have no barcode do not collide with each other.
DROP INDEX IF EXISTS idx_products_barcode;
CREATE UNIQUE INDEX idx_products_barcode ON products(barcode) WHERE barcode IS NOT NULL;

-- The product list sorts by name and almost always filters on is_active, so
-- the two together let a large catalogue page without sorting the whole table.
CREATE INDEX idx_products_active_name ON products(is_active, name COLLATE NOCASE);

-- ============================================================================
-- 0001_init — full schema (Guide §3)
--
-- Conventions:
--   * money  : REAL, always rounded to 2 dp before it is written
--   * qty    : REAL in BASE units unless the column is named otherwise
--   * date   : TEXT 'YYYY-MM-DD'      timestamp : TEXT 'YYYY-MM-DD HH:MM:SS'
--   * the source of truth for quantity is stock_movements;
--     products.stock_qty is a cache maintained in the same transaction
-- ============================================================================

-- ---------- reference ----------
CREATE TABLE categories (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE settings (               -- single row (id=1): business profile / header-footer
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  business_name   TEXT NOT NULL DEFAULT '',
  address         TEXT NOT NULL DEFAULT '',
  phone           TEXT NOT NULL DEFAULT '',
  tax_number      TEXT NOT NULL DEFAULT '',   -- NTN/STRN, optional
  tax_enabled     INTEGER NOT NULL DEFAULT 0, -- 0 = off by default
  tax_rate        REAL NOT NULL DEFAULT 0,    -- percent
  receipt_footer  TEXT NOT NULL DEFAULT '',
  logo_path       TEXT NOT NULL DEFAULT '',
  currency        TEXT NOT NULL DEFAULT 'PKR',
  auto_backup_dir TEXT NOT NULL DEFAULT ''    -- '' = auto-backup on close disabled
);
INSERT INTO settings (id) VALUES (1);

-- ---------- products & units ----------
CREATE TABLE products (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  sku           TEXT UNIQUE,
  barcode       TEXT,
  category_id   INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  base_unit     TEXT NOT NULL DEFAULT 'piece',  -- unit stock is counted in
  cost_price    REAL NOT NULL DEFAULT 0,        -- weighted-avg cost per BASE unit
  sale_price    REAL NOT NULL DEFAULT 0,        -- default sale price per BASE unit
  stock_qty     REAL NOT NULL DEFAULT 0,        -- cached; = SUM(stock_movements.change_qty)
  reorder_level REAL NOT NULL DEFAULT 0,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE product_units (          -- OPTIONAL alternate selling units; base unit is implicit (factor 1)
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  unit_name  TEXT NOT NULL,           -- 'box','dozen','packet',...
  factor     REAL NOT NULL CHECK (factor > 0), -- base units in ONE of this unit
  sale_price REAL,                    -- default price for this unit
  UNIQUE (product_id, unit_name)
);

-- ---------- parties ----------
CREATE TABLE customers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  phone           TEXT,
  address         TEXT,
  opening_balance REAL NOT NULL DEFAULT 0,  -- +ve = customer owes shop at system start
  current_balance REAL NOT NULL DEFAULT 0,  -- cached running balance (+ve = they owe)
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE suppliers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  phone           TEXT,
  address         TEXT,
  opening_balance REAL NOT NULL DEFAULT 0,  -- +ve = shop owes supplier
  current_balance REAL NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ---------- purchases (stock in) ----------
CREATE TABLE purchases (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER REFERENCES suppliers(id),
  invoice_no  TEXT,
  date        TEXT NOT NULL DEFAULT (date('now','localtime')),
  subtotal    REAL NOT NULL DEFAULT 0,
  discount    REAL NOT NULL DEFAULT 0,
  total       REAL NOT NULL DEFAULT 0,
  paid_amount REAL NOT NULL DEFAULT 0,
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE purchase_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id  INTEGER NOT NULL REFERENCES products(id),
  unit_name   TEXT NOT NULL,
  factor      REAL NOT NULL DEFAULT 1,
  qty         REAL NOT NULL,          -- in chosen unit
  base_qty    REAL NOT NULL,          -- qty * factor
  cost_price  REAL NOT NULL,          -- per BASE unit
  amount      REAL NOT NULL           -- base_qty * cost_price
);

-- ---------- sales (stock out) ----------
CREATE TABLE sales (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no   TEXT NOT NULL UNIQUE,
  customer_id  INTEGER REFERENCES customers(id),   -- NULL = walk-in cash
  date         TEXT NOT NULL DEFAULT (date('now','localtime')),
  subtotal     REAL NOT NULL DEFAULT 0,
  discount     REAL NOT NULL DEFAULT 0,            -- bill-level discount
  tax          REAL NOT NULL DEFAULT 0,
  total        REAL NOT NULL DEFAULT 0,
  paid_amount  REAL NOT NULL DEFAULT 0,
  payment_type TEXT NOT NULL DEFAULT 'cash'
               CHECK (payment_type IN ('cash','credit','partial')),
  notes        TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE sale_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id       INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id    INTEGER NOT NULL REFERENCES products(id),
  unit_name     TEXT NOT NULL,
  factor        REAL NOT NULL DEFAULT 1,
  qty           REAL NOT NULL,        -- in chosen unit
  base_qty      REAL NOT NULL,        -- qty * factor
  rate          REAL NOT NULL,        -- ACTUAL sale price per unit
  line_discount REAL NOT NULL DEFAULT 0,
  cost_price    REAL NOT NULL,        -- weighted-avg cost per BASE unit at sale time
  amount        REAL NOT NULL         -- qty*rate - line_discount
);

-- remembers the last price given to a customer for an item/unit
CREATE TABLE customer_item_prices (
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  unit_name   TEXT NOT NULL,
  last_rate   REAL NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (customer_id, product_id, unit_name)
);

-- ---------- returns ----------
CREATE TABLE sale_returns (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id     INTEGER REFERENCES sales(id),        -- optional link to original
  customer_id INTEGER REFERENCES customers(id),
  date        TEXT NOT NULL DEFAULT (date('now','localtime')),
  total       REAL NOT NULL DEFAULT 0,
  refund_type TEXT NOT NULL DEFAULT 'cash' CHECK (refund_type IN ('cash','credit')),
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE sale_return_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_return_id INTEGER NOT NULL REFERENCES sale_returns(id) ON DELETE CASCADE,
  product_id     INTEGER NOT NULL REFERENCES products(id),
  unit_name      TEXT NOT NULL,
  factor         REAL NOT NULL DEFAULT 1,
  qty            REAL NOT NULL,
  base_qty       REAL NOT NULL,
  rate           REAL NOT NULL,
  cost_price     REAL NOT NULL,       -- captured for correct profit reversal
  amount         REAL NOT NULL
);

CREATE TABLE purchase_returns (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER REFERENCES purchases(id),
  supplier_id INTEGER REFERENCES suppliers(id),
  date        TEXT NOT NULL DEFAULT (date('now','localtime')),
  total       REAL NOT NULL DEFAULT 0,
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE purchase_return_items (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_return_id INTEGER NOT NULL REFERENCES purchase_returns(id) ON DELETE CASCADE,
  product_id         INTEGER NOT NULL REFERENCES products(id),
  unit_name          TEXT NOT NULL,
  factor             REAL NOT NULL DEFAULT 1,
  qty                REAL NOT NULL,
  base_qty           REAL NOT NULL,
  cost_price         REAL NOT NULL,
  amount             REAL NOT NULL
);

-- ---------- money movements ----------
CREATE TABLE payments (               -- receipts from customers / payments to suppliers
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  party_type TEXT NOT NULL CHECK (party_type IN ('customer','supplier')),
  party_id   INTEGER NOT NULL,
  direction  TEXT NOT NULL CHECK (direction IN ('in','out')),
  amount     REAL NOT NULL,
  method     TEXT NOT NULL DEFAULT 'cash'
             CHECK (method IN ('cash','bank','cheque','online','other')),
  date       TEXT NOT NULL DEFAULT (date('now','localtime')),
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE expense_categories (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE expenses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER REFERENCES expense_categories(id) ON DELETE SET NULL,
  title       TEXT NOT NULL,
  amount      REAL NOT NULL,
  date        TEXT NOT NULL DEFAULT (date('now','localtime')),
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ---------- stock ledger (source of truth for quantity) ----------
CREATE TABLE stock_movements (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id),
  change_qty REAL NOT NULL,           -- +in / -out, in BASE units
  reason     TEXT NOT NULL CHECK (reason IN
             ('opening','purchase','sale','sale_return','purchase_return','adjustment')),
  ref_table  TEXT,
  ref_id     INTEGER,
  cost_price REAL,                    -- per base unit at time of movement
  date       TEXT NOT NULL DEFAULT (date('now','localtime')),
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

-- ---------- indexes ----------
CREATE INDEX idx_movements_product   ON stock_movements(product_id);
CREATE INDEX idx_movements_date      ON stock_movements(date);
CREATE INDEX idx_movements_ref       ON stock_movements(ref_table, ref_id);
CREATE INDEX idx_sales_date          ON sales(date);
CREATE INDEX idx_sales_customer      ON sales(customer_id);
CREATE INDEX idx_sale_items_sale     ON sale_items(sale_id);
CREATE INDEX idx_sale_items_product  ON sale_items(product_id);
CREATE INDEX idx_payments_party      ON payments(party_type, party_id);
CREATE INDEX idx_payments_date       ON payments(date);
CREATE INDEX idx_purchases_date      ON purchases(date);
CREATE INDEX idx_purchases_supplier  ON purchases(supplier_id);
CREATE INDEX idx_purchase_items_pur  ON purchase_items(purchase_id);
CREATE INDEX idx_expenses_date       ON expenses(date);
CREATE INDEX idx_sale_returns_date   ON sale_returns(date);
CREATE INDEX idx_sale_return_items   ON sale_return_items(sale_return_id);
CREATE INDEX idx_pur_returns_date    ON purchase_returns(date);
CREATE INDEX idx_pur_return_items    ON purchase_return_items(purchase_return_id);
CREATE INDEX idx_products_name       ON products(name);
CREATE INDEX idx_products_barcode    ON products(barcode);
CREATE INDEX idx_products_category   ON products(category_id);

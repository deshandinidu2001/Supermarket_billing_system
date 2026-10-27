const uuidSql =
  "lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-8'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6)))";
export const migrations = [
  {
    version: 1,
    sql: `
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, pin_hash TEXT, role TEXT NOT NULL CHECK(role IN ('owner','cashier')), active INTEGER NOT NULL DEFAULT 1, language TEXT NOT NULL DEFAULT 'en', must_change_password INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE categories (id TEXT PRIMARY KEY, name_en TEXT NOT NULL UNIQUE, name_si TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE suppliers (id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', credit_days INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE products (id TEXT PRIMARY KEY, sku TEXT NOT NULL UNIQUE, name_en TEXT NOT NULL, name_si TEXT NOT NULL, category_id TEXT NOT NULL REFERENCES categories(id), unit TEXT NOT NULL CHECK(unit IN ('pcs','kg','g','l','ml','pack')), selling_price INTEGER NOT NULL CHECK(selling_price>=0), mrp INTEGER, cost_price INTEGER NOT NULL DEFAULT 0 CHECK(cost_price>=0), reorder_level REAL NOT NULL DEFAULT 5, active INTEGER NOT NULL DEFAULT 1, quick_access INTEGER NOT NULL DEFAULT 0, supplier_id TEXT REFERENCES suppliers(id), image TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE product_barcodes (id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE, barcode TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX idx_barcode ON product_barcodes(barcode);
CREATE INDEX idx_product_en ON products(name_en COLLATE NOCASE);
CREATE INDEX idx_product_si ON products(name_si);
CREATE TABLE purchases (id TEXT PRIMARY KEY, supplier_id TEXT NOT NULL REFERENCES suppliers(id), invoice_no TEXT NOT NULL, date TEXT NOT NULL, total INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(supplier_id,invoice_no));
CREATE TABLE batches (id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), purchase_id TEXT REFERENCES purchases(id), qty REAL NOT NULL, cost_price INTEGER NOT NULL, expiry_date TEXT, received_date TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX idx_batch_product ON batches(product_id,expiry_date,received_date);
CREATE TABLE purchase_items (id TEXT PRIMARY KEY, purchase_id TEXT NOT NULL REFERENCES purchases(id), product_id TEXT NOT NULL REFERENCES products(id), batch_id TEXT NOT NULL REFERENCES batches(id), qty REAL NOT NULL, cost_price INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE stock_movements (id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id), batch_id TEXT NOT NULL REFERENCES batches(id), qty REAL NOT NULL, reason TEXT NOT NULL, reference_id TEXT, user_id TEXT REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX idx_movement_product ON stock_movements(product_id,batch_id);
CREATE TABLE supplier_payments (id TEXT PRIMARY KEY, supplier_id TEXT NOT NULL REFERENCES suppliers(id), amount INTEGER NOT NULL CHECK(amount>0), note TEXT NOT NULL DEFAULT '', date TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE cheques (id TEXT PRIMARY KEY, supplier_id TEXT NOT NULL REFERENCES suppliers(id), number TEXT NOT NULL, bank TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount>0), due_date TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','cleared','returned')), payment_id TEXT REFERENCES supplier_payments(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(bank,number));
CREATE TABLE customers (id TEXT PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL UNIQUE, address TEXT NOT NULL DEFAULT '', join_date TEXT NOT NULL, credit_limit INTEGER NOT NULL DEFAULT 0, balance INTEGER NOT NULL DEFAULT 0, points INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE shifts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), start_time TEXT NOT NULL, end_time TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE UNIQUE INDEX idx_open_shift ON shifts(user_id) WHERE end_time IS NULL;
CREATE TABLE sales (id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, bill_no TEXT NOT NULL UNIQUE, counter_id TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), customer_id TEXT REFERENCES customers(id), shift_id TEXT NOT NULL REFERENCES shifts(id), subtotal INTEGER NOT NULL, line_discount INTEGER NOT NULL, bill_discount INTEGER NOT NULL, loyalty_discount INTEGER NOT NULL, bag_total INTEGER NOT NULL, rounding INTEGER NOT NULL, total INTEGER NOT NULL, cost INTEGER NOT NULL, points_earned INTEGER NOT NULL DEFAULT 0, points_redeemed INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'completed', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX idx_sales_date ON sales(created_at);
CREATE INDEX idx_sales_user ON sales(user_id,created_at);
CREATE TABLE sale_items (id TEXT PRIMARY KEY, sale_id TEXT NOT NULL REFERENCES sales(id), product_id TEXT NOT NULL REFERENCES products(id), batch_id TEXT NOT NULL REFERENCES batches(id), line_id TEXT NOT NULL, name_en TEXT NOT NULL, name_si TEXT NOT NULL, unit TEXT NOT NULL, qty REAL NOT NULL, unit_price INTEGER NOT NULL, unit_cost INTEGER NOT NULL, discount INTEGER NOT NULL, line_total INTEGER NOT NULL, cost_total INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE payments (id TEXT PRIMARY KEY, sale_id TEXT NOT NULL REFERENCES sales(id), method TEXT NOT NULL CHECK(method IN ('cash','card','qr','credit')), amount INTEGER NOT NULL CHECK(amount>=0), reference TEXT NOT NULL DEFAULT '', tendered INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE held_bills (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL, cart TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('open','held')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE UNIQUE INDEX idx_open_cart ON held_bills(user_id) WHERE status='open';
CREATE TABLE returns (id TEXT PRIMARY KEY, sale_id TEXT NOT NULL REFERENCES sales(id), user_id TEXT NOT NULL REFERENCES users(id), approved_by TEXT NOT NULL REFERENCES users(id), reason TEXT NOT NULL, method TEXT NOT NULL, total INTEGER NOT NULL, cost INTEGER NOT NULL, is_void INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE return_items (id TEXT PRIMARY KEY, return_id TEXT NOT NULL REFERENCES returns(id), sale_item_id TEXT NOT NULL REFERENCES sale_items(id), qty REAL NOT NULL, damaged INTEGER NOT NULL, amount INTEGER NOT NULL, cost INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE loyalty_transactions (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id), sale_id TEXT REFERENCES sales(id), return_id TEXT REFERENCES returns(id), points INTEGER NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE customer_payments (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES customers(id), amount INTEGER NOT NULL CHECK(amount>0), note TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE expenses (id TEXT PRIMARY KEY, date TEXT NOT NULL, amount INTEGER NOT NULL CHECK(amount>0), note TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE audit_logs (id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), action TEXT NOT NULL, entity_id TEXT, details TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE settings (id TEXT PRIMARY KEY, value TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE counters (id TEXT PRIMARY KEY, sequence INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
`,
  },
  {
    version: 2,
    sql: "ALTER TABLE returns ADD COLUMN credit_amount INTEGER NOT NULL DEFAULT 0; UPDATE returns SET credit_amount=total WHERE method='credit';",
  },
  {
    version: 3,
    sql: `ALTER TABLE settings ADD COLUMN setting_key TEXT NOT NULL DEFAULT 'app';
      UPDATE settings SET id=${uuidSql};
      CREATE UNIQUE INDEX idx_setting_key ON settings(setting_key);
      ALTER TABLE counters ADD COLUMN counter_id TEXT;
      UPDATE counters SET counter_id=id,id=${uuidSql};
      CREATE UNIQUE INDEX idx_counter_id ON counters(counter_id);`,
  },
];

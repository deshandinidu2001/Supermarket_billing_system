import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, today, uid } from '../db/database';
import { seed } from '../db/seed';
import { Auth } from '../services/auth';
import { Inventory } from '../services/inventory';
import { Management } from '../services/management';
import { POS } from '../services/pos';
import { Reports } from '../services/reports';
import { cartTotals } from '../services/calculations';
import { reportNames } from '../shared/contracts';
import { emptyCart } from '../shared/types';
import { Backups, verifyBackup } from '../electron/backup';
import { readdirSync, writeFileSync } from 'node:fs';
async function run() {
  const directory = mkdtempSync(join(tmpdir(), 'ajith-integration-'));
  const store = new Store(join(directory, 'test.db'));
  console.log('Phase 1: SQLite migration, WAL, foreign keys and integrity');
  assert.equal(store.integrity(), 'ok');
  assert.equal(store.db.pragma('journal_mode', { simple: true }), 'wal');
  assert.equal(store.db.pragma('foreign_keys', { simple: true }), 1);
  seed(store, true);
  const auth = new Auth(store),
    inventory = new Inventory(store, auth),
    management = new Management(store, auth),
    pos = new POS(store, auth, inventory),
    reports = new Reports(store, auth);
  console.log('Phase 2: sample data, hashed login, forced password change and roles');
  assert.equal(Number(store.get('SELECT COUNT(*) n FROM products')!.n), 40);
  assert.equal(Number(store.get('SELECT COUNT(*) n FROM suppliers')!.n), 5);
  assert.equal(Number(store.get('SELECT COUNT(*) n FROM customers')!.n), 10);
  assert.throws(() => auth.login('owner', 'bad'), /invalidCredentials/);
  const owner = auth.login('owner', 'ajith123');
  assert.equal(owner.must_change_password, 1);
  assert.throws(() => inventory.search(), /passwordChangeRequired/);
  auth.changePassword('ajith123', 'owner-test-2026', '4321');
  console.log('Phase 3: bilingual/barcode search, cost redaction and stock ledger');
  const products = inventory.search();
  assert.equal(products.length, 40);
  assert.equal(inventory.search('නාඩු')[0].name_en, 'Nadu rice');
  assert.equal(inventory.search(products[0].barcode)[0].id, products[0].id);
  assert.equal(inventory.assertLedger().length, 0);
  console.log('Phase 4: transactional GRN, supplier payments and cleared cheques');
  const supplier = String(management.list('suppliers')[0].id),
    product = products.find((p) => p.unit === 'kg')!;
  const before = inventory.byIds([product.id])[0].stock;
  const purchase = inventory.purchase({
    supplier_id: supplier,
    invoice_no: 'TEST-001',
    date: today(),
    items: [{ product_id: product.id, qty: 5, cost_price: 10000, expiry_date: '2099-01-01' }],
  });
  assert.ok(purchase);
  assert.equal(inventory.byIds([product.id])[0].stock, before + 5);
  assert.throws(() =>
    inventory.purchase({
      supplier_id: supplier,
      invoice_no: 'TEST-001',
      date: today(),
      items: [{ product_id: product.id, qty: 5, cost_price: 10000, expiry_date: null }],
    }),
  );
  assert.equal(inventory.byIds([product.id])[0].stock, before + 5);
  const chequeData = {
    supplier_id: supplier,
    number: 'TEST-CHQ-1',
    bank: 'Test bank',
    amount: 10000,
    due_date: today(),
    status: 'pending',
  };
  const cheque = management.save('cheques', chequeData);
  management.save('cheques', { ...chequeData, id: cheque, status: 'cleared' });
  assert.ok(store.get('SELECT payment_id FROM cheques WHERE id=?', cheque)!.payment_id);
  assert.throws(() => management.delete('cheques', cheque), /clearedChequeLocked/);
  assert.throws(
    () => management.save('cheques', { ...chequeData, id: cheque, status: 'returned' }),
    /clearedChequeLocked/,
  );
  console.log('Phase 5: held carts, split checkout, idempotency and failure rollback');
  pos.shift('start');
  const cart = {
    ...emptyCart(),
    lines: [{ product_id: product.id, qty: 1.25, discount_percent: 2 }],
    discount_value: 1,
  };
  pos.saveCart(cart);
  const held = pos.hold('Test customer');
  assert.equal(pos.loadCart().lines.length, 0);
  pos.resume(held);
  assert.equal(pos.loadCart().lines[0].qty, 1.25);
  const totals = cartTotals(cart, inventory.byIds([product.id]), store.settings());
  const request = uid();
  const payment = [
    { method: 'cash' as const, amount: totals.total, tendered: 1000000, reference: '' },
  ];
  const sale = pos.checkout({ request_id: request, payments: payment });
  assert.equal(pos.checkout({ request_id: request, payments: payment }).id, sale.id);
  assert.equal(inventory.byIds([product.id])[0].stock, before + 3.75);
  assert.equal(pos.loadCart().lines.length, 0);
  const immutableCost = Number(store.get('SELECT cost FROM sales WHERE id=?', sale.id)!.cost);
  store.update('products', product.id, { cost_price: 9999999 });
  assert.equal(
    Number(store.get('SELECT cost FROM sales WHERE id=?', sale.id)!.cost),
    immutableCost,
  );
  pos.saveCart({
    ...emptyCart(),
    lines: [{ product_id: product.id, qty: 999999, discount_percent: 0 }],
  });
  const stockBeforeFailure = inventory.byIds([product.id])[0].stock;
  assert.throws(() =>
    pos.checkout({
      request_id: uid(),
      payments: [
        {
          method: 'cash',
          amount: 999999 * product.selling_price,
          tendered: 999999 * product.selling_price,
          reference: '',
        },
      ],
    }),
  );
  assert.equal(inventory.byIds([product.id])[0].stock, stockBeforeFailure);
  pos.saveCart(emptyCart());
  console.log('Phase 6: PIN approval, returns, credit/loyalty, shift and cashier boundaries');
  auth.logout();
  auth.login('cashier', 'cashier123');
  auth.changePassword('cashier123', 'cashier-test-2026');
  assert.equal(inventory.search()[0].cost_price, undefined);
  assert.throws(() => management.list('suppliers'));
  assert.throws(() => reports.dashboard(today(), today()));
  assert.throws(() => auth.approve('0000'));
  assert.equal(auth.approve('4321'), owner.id);
  assert.equal(pos.receipt(sale.bill_no).items[0].unit_cost, undefined);
  const receipt = pos.receipt(sale.bill_no);
  const returnItems = receipt.items.map((i) => ({
    sale_item_id: String(i.id),
    qty: Number(i.qty),
    damaged: false,
  }));
  pos.returnSale({
    sale_id: sale.id,
    items: returnItems,
    reason: 'Test return',
    owner_pin: '4321',
    method: 'cash',
    void: false,
  });
  assert.equal(inventory.byIds([product.id])[0].stock, before + 5);
  assert.throws(() =>
    pos.returnSale({
      sale_id: sale.id,
      items: returnItems,
      reason: 'Again',
      owner_pin: '4321',
      method: 'cash',
      void: false,
    }),
  );
  auth.logout();
  auth.login('owner', 'owner-test-2026');
  const customer = management.list('customers')[0];
  const creditCart = {
    ...emptyCart(),
    customer_id: String(customer.id),
    lines: [{ product_id: product.id, qty: 1, discount_percent: 0 }],
  };
  pos.saveCart(creditCart);
  const creditTotals = cartTotals(creditCart, inventory.byIds([product.id]), store.settings());
  const credit = pos.checkout({
    request_id: uid(),
    payments: [{ method: 'credit', amount: creditTotals.total, tendered: 0, reference: '' }],
  });
  assert.equal(
    Number(store.get('SELECT balance FROM customers WHERE id=?', String(customer.id))!.balance),
    creditTotals.total,
  );
  const payId = management.customerPayment({
    customer_id: String(customer.id),
    amount: creditTotals.total,
    note: 'Collected',
  });
  assert.ok(payId);
  assert.equal(
    Number(store.get('SELECT balance FROM customers WHERE id=?', String(customer.id))!.balance),
    0,
  );
  assert.ok(credit.bill_no);
  pos.saveCart(creditCart);
  const splitCredit = pos.checkout({
    request_id: uid(),
    payments: [
      { method: 'credit', amount: 10000, tendered: 0, reference: '' },
      {
        method: 'cash',
        amount: creditTotals.total - 10000,
        tendered: creditTotals.total,
        reference: '',
      },
    ],
  });
  const splitReceipt = pos.receipt(splitCredit.bill_no);
  pos.returnSale({
    sale_id: splitCredit.id,
    items: splitReceipt.items.map((i) => ({
      sale_item_id: String(i.id),
      qty: Number(i.qty),
      damaged: false,
    })),
    reason: 'Split refund',
    method: 'cash',
    void: true,
  });
  assert.equal(
    Number(store.get('SELECT balance FROM customers WHERE id=?', String(customer.id))!.balance),
    0,
  );
  assert.equal(
    Number(
      store.get('SELECT credit_amount FROM returns WHERE sale_id=?', splitCredit.id)!.credit_amount,
    ),
    10000,
  );
  const priorStatus = store.get('SELECT status FROM sales WHERE id=?', splitCredit.id)!.status;
  assert.equal(priorStatus, 'void');
  console.log('Phase 7: every report query, expenses and profit totals');
  for (const name of reportNames) {
    const result = reports.report(name, '2020-01-01', '2099-12-31');
    assert.ok(result.columns.length > 0);
    assert.ok(Array.isArray(result.rows));
  }
  const expense = management.save('expenses', {
    date: today(),
    amount: 10000,
    note: 'Test expense',
  });
  const dash = reports.dashboard('2020-01-01', '2099-12-31');
  assert.equal(dash.net_profit, dash.gross_profit - dash.expenses);
  assert.equal(dash.months.length, 12);
  management.delete('expenses', expense);
  console.log('Phase 8: consistent online backup and reopening persisted cart');
  console.log('Performance: 20,000 products and a 50-line transaction');
  const categoryId = String(store.get('SELECT id FROM categories LIMIT 1')!.id);
  const stamp = new Date().toISOString();
  const benchmarkIds: string[] = [];
  const addProduct = store.db.prepare(
    'INSERT INTO products (id,sku,name_en,name_si,category_id,unit,selling_price,cost_price,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)',
  );
  const addBarcode = store.db.prepare(
    'INSERT INTO product_barcodes (id,product_id,barcode,created_at,updated_at) VALUES (?,?,?,?,?)',
  );
  store.db.transaction(() => {
    for (let i = 0; i < 20000; i++) {
      const id = uid();
      addProduct.run(
        id,
        `PERF-${i}`,
        `Benchmark product ${i}`,
        'පරීක්ෂණ භාණ්ඩය ' + i,
        categoryId,
        'pcs',
        10000,
        7500,
        stamp,
        stamp,
      );
      addBarcode.run(uid(), id, `999${String(i).padStart(10, '0')}`, stamp, stamp);
      if (i < 50) {
        benchmarkIds.push(id);
        inventory.newBatch(id, 20, 7500, null, null, owner.id);
      }
    }
  })();
  const timings: number[] = [];
  for (let i = 0; i < 20; i++) {
    const start = performance.now();
    assert.ok(inventory.search(i % 2 ? 'product 19999' : '9990000019999').length);
    timings.push(performance.now() - start);
  }
  timings.sort((a, b) => a - b);
  assert.ok(timings[18] < 100, `Search p95 ${timings[18]}ms`);
  const large = {
    ...emptyCart(),
    lines: benchmarkIds.map((product_id) => ({ product_id, qty: 1, discount_percent: 0 })),
  };
  const begin = performance.now();
  pos.saveCart(large);
  pos.checkout({
    request_id: uid(),
    payments: [{ method: 'cash', amount: 500000, tendered: 500000, reference: '' }],
  });
  console.log(
    `Search p95 ${timings[18].toFixed(2)}ms; 50-line save + checkout ${(performance.now() - begin).toFixed(2)}ms`,
  );
  const backup = join(directory, 'backup.db');
  await store.db.backup(backup);
  verifyBackup(backup);
  const copied = new Store(backup);
  assert.equal(copied.integrity(), 'ok');
  copied.close();
  assert.equal(inventory.assertLedger().length, 0);
  const backupFolder = join(directory, 'auto-backups');
  store.saveSettings({
    ...store.settings(),
    backup_folder: backupFolder,
    backup_keep: 2,
    last_backup: '',
  });
  const automatic = new Backups(store, auth);
  await automatic.daily();
  assert.ok(store.settings().last_backup);
  const lastBackup = store.settings().last_backup;
  await automatic.daily();
  assert.equal(store.settings().last_backup, lastBackup);
  await automatic.backup(false, true);
  await automatic.backup(false, true);
  assert.equal(readdirSync(backupFolder).filter((f) => f.endsWith('.db')).length, 2);
  const invalid = join(directory, 'invalid.db');
  writeFileSync(invalid, 'not a database');
  assert.throws(() => verifyBackup(invalid), /invalidBackup/);
  auth.lastActivity = Date.now() - store.settings().idle_minutes * 60000 - 1;
  assert.throws(() => auth.current(), /sessionExpired/);
  assert.equal(auth.userId, null);
  store.close();
  const reopened = new Store(join(directory, 'test.db'));
  assert.equal(reopened.integrity(), 'ok');
  reopened.close();
  console.log(`All integration checks passed. Test data: ${directory}`);
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

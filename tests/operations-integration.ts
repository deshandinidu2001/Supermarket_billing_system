import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, today, uid } from '../db/database';
import { seed } from '../db/seed';
import { Auth } from '../services/auth';
import { Inventory } from '../services/inventory';
import { StockOperations } from '../services/stock-operations';
import { Management } from '../services/management';
import { Reports } from '../services/reports';
import { POS } from '../services/pos';
import { cartTotals } from '../services/calculations';
import { emptyCart } from '../shared/types';
import { productSchema } from '../shared/contracts';
import { Backups, verifyBackup } from '../electron/backup';
import { receiptHtml } from '../electron/files';

async function run() {
  const folder = mkdtempSync(join(tmpdir(), 'ajith-operations-'));
  const store = new Store(join(folder, 'test.db'));
  try {
    seed(store, true);
    const auth = new Auth(store),
      inventory = new Inventory(store, auth),
      operations = new StockOperations(inventory),
      management = new Management(store, auth),
      reports = new Reports(store, auth),
      pos = new POS(store, auth, inventory);
    const owner = auth.login('owner', 'ajith123');
    auth.changePassword('ajith123', 'owner-operations-2026', '4321');
    const cashier = management.list('users').find((user) => user.role === 'cashier')!;
    const pcs = inventory.search().find((product) => product.unit === 'pcs')!;
    const measured = inventory.search().find((product) => product.unit === 'kg')!;

    console.log(
      'Operations: PIN setup, first-password requirement, account isolation and access control',
    );
    const ownerPin = store.get('SELECT pin_hash FROM users WHERE id=?', owner.id)!.pin_hash;
    auth.setCashierPin(String(cashier.id), '2468');
    assert.equal(auth.cashierAccounts().length, 0);
    assert.throws(() => auth.loginPin(String(cashier.id), '2468'), /passwordChangeRequired/);
    auth.login('cashier', 'cashier123');
    auth.changePassword('cashier123', 'cashier-operations-2026');
    assert.throws(() => operations.startStocktake(), /forbidden/);
    assert.throws(() => operations.supplierReturns(), /forbidden/);
    assert.throws(() => auth.setCashierPin(String(cashier.id), '9999'), /forbidden/);
    for (const action of [
      'stocktakes',
      'startStocktake',
      'stocktake',
      'saveStocktake',
      'supplierReturnBatches',
      'supplierReturns',
      'supplierReturn',
      'supplierReturnDetails',
      'setCashierPin',
      'backupStatus',
      'verifyLatestBackup',
    ])
      assert.throws(() => auth.authorize(action), /forbidden/);
    auth.login('owner', 'owner-operations-2026');
    assert.deepEqual(Object.keys(auth.cashierAccounts()[0]).sort(), ['display_name', 'id']);
    assert.notEqual(
      store.get('SELECT cashier_pin_hash FROM users WHERE id=?', String(cashier.id))!
        .cashier_pin_hash,
      '2468',
    );
    assert.equal(store.get('SELECT pin_hash FROM users WHERE id=?', owner.id)!.pin_hash, ownerPin);
    pos.saveCart({ ...emptyCart(), lines: [{ product_id: pcs.id, qty: 1, discount_percent: 0 }] });
    auth.loginPin(String(cashier.id), '2468');
    assert.equal(pos.loadCart().lines.length, 0);
    pos.saveCart({ ...emptyCart(), lines: [{ product_id: pcs.id, qty: 2, discount_percent: 0 }] });
    assert.throws(() => auth.loginPin(String(cashier.id), '1111'), /invalidPin/);
    assert.equal(auth.current().id, cashier.id);
    auth.login('owner', 'owner-operations-2026');
    assert.equal(pos.loadCart().lines[0].qty, 1);
    auth.loginPin(String(cashier.id), '2468');
    assert.equal(pos.loadCart().lines[0].qty, 2);
    auth.login('owner', 'owner-operations-2026');
    pos.saveCart(emptyCart());

    console.log(
      'Operations: saved physical counts, variance application, stale-count rollback and idempotency',
    );
    const before = inventory.byIds([pcs.id, measured.id]);
    const id = operations.startStocktake();
    const counts = [
      {
        product_id: pcs.id,
        counted_qty: before[0].id === pcs.id ? before[0].stock - 2 : before[1].stock - 2,
      },
      { product_id: measured.id, counted_qty: inventory.byIds([measured.id])[0].stock + 1.25 },
    ];
    operations.saveStocktake({ id, counts, complete: false });
    assert.equal(
      new StockOperations(inventory).stocktake(id).lines.filter((line) => line.counted_qty != null)
        .length,
      2,
    );
    assert.equal(
      inventory.byIds([pcs.id])[0].stock,
      before.find((product) => product.id === pcs.id)!.stock,
    );
    operations.saveStocktake({ id, counts: [], complete: true });
    assert.equal(inventory.byIds([pcs.id])[0].stock, counts[0].counted_qty);
    assert.equal(inventory.byIds([measured.id])[0].stock, counts[1].counted_qty);
    operations.saveStocktake({ id, counts, complete: true });
    assert.equal(inventory.byIds([pcs.id])[0].stock, counts[0].counted_qty);
    assert.equal(inventory.assertLedger().length, 0);
    const stale = operations.startStocktake();
    const pcsBeforeConflict = inventory.byIds([pcs.id])[0].stock;
    inventory.adjust({
      product_id: measured.id,
      batch_id: null,
      qty: 1,
      cost_price: 20000,
      expiry_date: null,
      reason: 'correction',
    });
    assert.throws(
      () =>
        operations.saveStocktake({
          id: stale,
          complete: true,
          counts: [
            { product_id: pcs.id, counted_qty: pcsBeforeConflict - 1 },
            { product_id: measured.id, counted_qty: 1 },
          ],
        }),
      /stockChangedDuringCount/,
    );
    assert.equal(inventory.byIds([pcs.id])[0].stock, pcsBeforeConflict);
    assert.equal(operations.stocktake(stale).session.status, 'draft');
    assert.throws(
      () =>
        operations.saveStocktake({
          id: stale,
          complete: false,
          counts: [{ product_id: pcs.id, counted_qty: 3.5 }],
        }),
      /wholeQuantity/,
    );
    operations.saveStocktake({
      id: stale,
      complete: false,
      counts: [{ product_id: pcs.id, counted_qty: 2 }],
    });
    operations.saveStocktake({
      id: stale,
      complete: false,
      counts: [{ product_id: pcs.id, counted_qty: null }],
    });
    assert.equal(
      operations.stocktake(stale).lines.find((line) => line.product_id === pcs.id)!.counted_qty,
      null,
    );

    console.log(
      'Operations: supplier batch ownership, credit amounts, duplicate protection and stock ledger',
    );
    const suppliers = management.list('suppliers');
    const supplier = String(suppliers[0].id),
      otherSupplier = String(suppliers[1].id);
    const purchase = inventory.purchase({
      supplier_id: supplier,
      invoice_no: 'OPS-RETURN',
      date: today(),
      items: [{ product_id: pcs.id, qty: 10, cost_price: 10000, expiry_date: null }],
    });
    const batch = store.get('SELECT id FROM batches WHERE purchase_id=?', purchase)!;
    const balance = Number(
      management.list('suppliers').find((row) => row.id === supplier)!.balance,
    );
    const input = {
      request_id: uid(),
      supplier_id: supplier,
      date: today(),
      reason: 'Damaged packaging',
      items: [{ batch_id: String(batch.id), qty: 3 }],
    };
    const returned = operations.supplierReturn(input);
    assert.equal(Number(store.get('SELECT qty FROM batches WHERE id=?', batch.id)!.qty), 7);
    assert.equal(Number(operations.supplierReturnDetails(returned).record.total), 30000);
    assert.equal(
      Number(management.list('suppliers').find((row) => row.id === supplier)!.balance),
      balance - 30000,
    );
    assert.equal(
      Number(
        reports
          .report('supplierBalances', today(), today())
          .rows.find((row) => row.name === suppliers[0].name)!.balance,
      ),
      balance - 30000,
    );
    assert.throws(
      () =>
        management.supplierPayment({
          supplier_id: supplier,
          amount: balance - 30000 + 1,
          date: today(),
          note: '',
        }),
      /paymentExceedsBalance/,
    );
    assert.equal(operations.supplierReturn(input), returned);
    assert.equal(Number(store.get('SELECT qty FROM batches WHERE id=?', batch.id)!.qty), 7);
    for (const invalid of [
      { ...input, request_id: uid(), supplier_id: otherSupplier },
      { ...input, request_id: uid(), items: [{ batch_id: String(batch.id), qty: 8 }] },
      { ...input, request_id: uid(), items: [{ batch_id: String(batch.id), qty: 1.5 }] },
    ])
      assert.throws(() => operations.supplierReturn(invalid));
    assert.equal(operations.supplierReturns().length, 1);
    const weightedPurchase = inventory.purchase({
      supplier_id: supplier,
      invoice_no: 'OPS-FRACTIONS',
      date: today(),
      items: [{ product_id: measured.id, qty: 1.5, cost_price: 23123, expiry_date: null }],
    });
    const weightedBatch = String(
      store.get('SELECT id FROM batches WHERE purchase_id=?', weightedPurchase)!.id,
    );
    let credit = 0;
    for (const qty of [0.333, 0.333, 0.834]) {
      const returnId = operations.supplierReturn({
        ...input,
        request_id: uid(),
        items: [{ batch_id: weightedBatch, qty }],
      });
      credit += Number(operations.supplierReturnDetails(returnId).record.total);
    }
    assert.equal(credit, Math.round(1.5 * 23123));
    assert.equal(inventory.assertLedger().length, 0);

    console.log(
      'Operations: out-of-stock and expired-stock blocking, receipt barcode and printed output',
    );
    const newId = inventory.save(
      productSchema.parse({
        ...pcs,
        id: undefined,
        sku: 'OPS-ZERO',
        barcodes: ['8899001122334'],
        active: true,
        quick_access: false,
        mrp: null,
        supplier_id: null,
        image: null,
      }),
    );
    const cart = { ...emptyCart(), lines: [{ product_id: newId, qty: 1, discount_percent: 0 }] };
    assert.equal(inventory.search('OPS-ZERO')[0].available_stock, 0);
    assert.throws(() => pos.saveCart(cart), /insufficientStock/);
    inventory.adjust({
      product_id: newId,
      batch_id: null,
      qty: 5,
      cost_price: 10000,
      expiry_date: '2020-01-01',
      reason: 'correction',
    });
    assert.equal(inventory.search('OPS-ZERO')[0].stock, 5);
    assert.equal(inventory.search('OPS-ZERO')[0].available_stock, 0);
    assert.throws(() => pos.saveCart(cart), /insufficientStock/);
    inventory.adjust({
      product_id: newId,
      batch_id: null,
      qty: 2,
      cost_price: 10000,
      expiry_date: null,
      reason: 'correction',
    });
    assert.throws(
      () => pos.saveCart({ ...cart, lines: [{ ...cart.lines[0], qty: 3 }] }),
      /insufficientStock/,
    );
    pos.saveCart({ ...cart, lines: [{ ...cart.lines[0], qty: 2 }] });
    const total = cartTotals(pos.loadCart(), inventory.byIds([newId]), store.settings()).total;
    const sale = pos.checkout({
      request_id: uid(),
      payments: [{ method: 'cash', amount: total, tendered: total, reference: '' }],
    });
    const receipt = pos.receipt(sale.bill_no);
    assert.match(receipt.barcode, /^data:image\/svg\+xml;base64,/);
    assert.match(Buffer.from(receipt.barcode.split(',')[1], 'base64').toString(), /<svg/);
    assert.ok(receiptHtml(receipt, 'en').includes(receipt.barcode));
    assert.equal(inventory.search('OPS-ZERO')[0].available_stock, 0);
    // A legacy saved cart cannot use the administrative negative-stock setting to bypass sale limits.
    pos.saveCart({ ...emptyCart(), lines: [{ product_id: pcs.id, qty: 1, discount_percent: 0 }] });
    const open = store.get(
      "SELECT id FROM held_bills WHERE user_id=? AND status='open'",
      owner.id,
    )!;
    store.update('held_bills', String(open.id), { cart: JSON.stringify(cart) });
    store.saveSettings({ ...store.settings(), allow_negative: true });
    assert.throws(
      () =>
        pos.checkout({
          request_id: uid(),
          payments: [
            {
              method: 'cash',
              amount: pcs.selling_price,
              tendered: pcs.selling_price,
              reference: '',
            },
          ],
        }),
      /insufficientStock/,
    );
    store.saveSettings({ ...store.settings(), allow_negative: false });
    pos.saveCart(emptyCart());

    console.log('Operations: verified online backups and durable failed-verification status');
    store.saveSettings({
      ...store.settings(),
      backup_folder: join(folder, 'backups'),
      backup_keep: 3,
    });
    const backups = new Backups(store, auth);
    const path = (await backups.backup())!;
    assert.equal(backups.status()!.status, 'passed');
    assert.equal(backups.status()!.path, path);
    verifyBackup(path);
    const restored = new Store(path);
    assert.equal(restored.integrity(), 'ok');
    assert.equal(restored.get('SELECT status FROM stocktakes WHERE id=?', id)!.status, 'completed');
    assert.ok(restored.get('SELECT id FROM supplier_returns WHERE id=?', returned));
    restored.close();
    const original = readFileSync(path);
    writeFileSync(path, 'invalid backup content');
    assert.throws(() => backups.verifyLatest(), /invalidBackup/);
    assert.equal(backups.status()!.status, 'failed');
    writeFileSync(path, original);
    assert.equal(backups.verifyLatest().status, 'passed');
    assert.equal(new Backups(store, auth).status()!.status, 'passed');
    assert.equal(inventory.assertLedger().length, 0);
    assert.equal(store.integrity(), 'ok');

    auth.setCashierPin(String(cashier.id), null);
    assert.equal(auth.cashierAccounts().length, 0);
    const limited = new Auth(store);
    for (let attempt = 0; attempt < 5; attempt++)
      assert.throws(() => limited.loginPin(String(cashier.id), '1111'), /invalidPin/);
    assert.throws(() => limited.loginPin(String(cashier.id), '1111'), /tryLater/);
    console.log(`All operations integration checks passed. Test data: ${folder}`);
  } finally {
    store.close();
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

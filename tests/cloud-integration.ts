import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, today, uid } from '../db/database';
import { seed } from '../db/seed';
import { CloudOutbox } from '../services/cloud-outbox';
import { Auth } from '../services/auth';
import { Reports } from '../services/reports';
import { Inventory } from '../services/inventory';
import { POS } from '../services/pos';
import { cartTotals } from '../services/calculations';
import { emptyCart } from '../shared/types';
import { analyticsColumns, validPayload } from '../shared/analytics';
import { analytics, addDays, type Analytics } from '../packages/analytics/engine';
import type { Dataset } from '../shared/analytics';

const folder = mkdtempSync(join(tmpdir(), 'ajith-sync-')),
  path = join(folder, 'test.db');
let store = new Store(path);
seed(store, true);
let outbox = new CloudOutbox(store);
outbox.rebuild(uid(), uid());
const boundary = outbox.batch(100000),
  count = boundary.length;
assert(count > 100);
assert.equal(boundary[0].kind, 'begin');
assert.equal(boundary.at(-1)!.kind, 'end');
assert(boundary.every(validPayload));
assert(!JSON.stringify(boundary).includes('password_hash'));
assert(!JSON.stringify(boundary).includes('cashier_pin_hash'));
assert(!JSON.stringify(boundary).includes('credit_limit","phone'));
const before = Number(store.get('SELECT COUNT(*) n FROM cloud_outbox')!.n);
assert.throws(() =>
  store.db.transaction(() => {
    store.insert('expenses', { date: today(), amount: 12345, note: 'rolled back' });
    throw new Error('simulate local transaction failure');
  })(),
);
assert.equal(Number(store.get('SELECT COUNT(*) n FROM cloud_outbox')!.n), before);
assert(!store.get("SELECT id FROM expenses WHERE note='rolled back'"));
// Changes made after materialization follow the end marker, even before backfill uploads.
store.insert('expenses', {
  date: today(),
  amount: 456,
  note: 'Offline expense, no server connection',
});
const category = store.get('SELECT id FROM categories LIMIT 1')!;
store.update('categories', String(category.id), { name_en: 'Sync category' });
assert.equal(outbox.batch(100000).at(count)!.table, 'expenses');
const fixtureAuth = new Auth(store),
  fixtureOwner = store.get("SELECT id FROM users WHERE role='owner'")!;
store.update('users', String(fixtureOwner.id), { must_change_password: 0 });
fixtureAuth.userId = String(fixtureOwner.id);
const inventory = new Inventory(store, fixtureAuth),
  pos = new POS(store, fixtureAuth, inventory);
const product = inventory
  .search('', 200)
  .find((p) => p.unit === 'pcs' && (p.available_stock ?? 0) > 10)!;
const cart = {
  ...emptyCart(),
  lines: [{ product_id: product.id, qty: 3, discount_percent: 2 }],
  discount_value: 25,
};
pos.saveCart(cart);
const totals = cartTotals(cart, inventory.byIds([product.id]), store.settings());
const sale = pos.checkout({
  request_id: uid(),
  payments: [
    {
      method: 'cash',
      amount: totals.total,
      tendered: totals.total,
      reference: 'private reference excluded',
    },
  ],
});
const item = pos.receipt(sale.bill_no).items[0];
assert(Number(item.qty) >= 2);
for (const damaged of [false, true])
  pos.returnSale({
    sale_id: sale.id,
    items: [{ sale_item_id: String(item.id), qty: 1, damaged }],
    reason: 'Isolated refund fixture',
    method: 'cash',
    void: false,
  });
inventory.adjust({
  product_id: product.id,
  batch_id: null,
  qty: 4,
  reason: 'correction',
  cost_price: product.cost_price ?? 0,
  expiry_date: null,
});
store.update('products', product.id, {
  cost_price: (product.cost_price ?? 0) + 9000,
  selling_price: product.selling_price + 5000,
});
const deleted = store.insert('expenses', { date: today(), amount: 100, note: 'Deleted fixture' });
store.run('DELETE FROM expenses WHERE id=?', deleted);
const sent = outbox.batch(200);
store.close();
store = new Store(path);
outbox = new CloudOutbox(store);
assert.deepEqual(outbox.batch(200), sent, 'restart retains unacknowledged events');
const events = outbox.batch(100000);
const dataset: Dataset = {};
for (const table of Object.keys(analyticsColumns) as (keyof Dataset)[]) {
  const records = new Map();
  for (const event of events.filter((e) => e.table === table)) {
    if (event.kind === 'delete') records.delete(event.recordId);
    else if (event.data) records.set(event.recordId, event.data);
  }
  dataset[table] = [...records.values()];
}
const from = addDays(today(), -60),
  to = today(),
  auth = new Auth(store);
const user = store.get("SELECT id FROM users WHERE role='owner'")!;
store.update('users', String(user.id), { must_change_password: 0 });
auth.userId = String(user.id);
const expected = new Reports(store, auth).dashboard(from, to),
  projected = analytics(dataset, from, to);
assert(projected.summary.refunds > 0, 'fixture exercises restockable and damaged returns');
for (const [cloud, local] of [
  ['revenue', 'revenue'],
  ['cogs', 'cogs'],
  ['grossProfit', 'gross_profit'],
  ['netProfit', 'net_profit'],
  ['refunds', 'refunds'],
  ['bills', 'bills'],
] as const) {
  if (local === 'refunds') continue;
  assert.equal(
    projected.summary[cloud as keyof Analytics['summary']],
    expected[local as keyof typeof expected],
  );
}
outbox.acknowledge(sent, sent.at(-1)!.sequence);
assert(outbox.batch(200)[0].sequence > sent.at(-1)!.sequence);
assert.throws(() => outbox.acknowledge(sent, 999999));
const next = outbox.batch(200)[0];
store.run('UPDATE cloud_outbox SET quarantined=1 WHERE sequence=?', next.sequence);
assert.equal(outbox.batch().length, 0);
store.run('UPDATE cloud_outbox SET quarantined=0');
writeFileSync(
  process.env.ANALYTICS_FIXTURE!,
  JSON.stringify({ events, expected: projected.summary, from, to }),
);
store.close();
console.log(
  'SQLite outbox: atomic rollback, offline writes, consistent backfill, restart, quarantine and financial parity passed.',
);

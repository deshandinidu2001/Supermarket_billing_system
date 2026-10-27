import bcrypt from 'bcryptjs';
import { Store, localDate, now, uid } from './database';
import { Auth } from '../services/auth';
import { Inventory } from '../services/inventory';
import { POS } from '../services/pos';
export function seed(store: Store, demo = false) {
  if (!store.get('SELECT id FROM users LIMIT 1'))
    store.insert('users', {
      username: 'owner',
      display_name: 'Ajith',
      password_hash: bcrypt.hashSync('ajith123', 12),
      role: 'owner',
      must_change_password: 1,
    });
  if (!demo || store.get('SELECT id FROM products LIMIT 1')) return;
  const owner = String(store.get("SELECT id FROM users WHERE role='owner' LIMIT 1")!.id);
  const auth = new Auth(store);
  auth.userId = owner;
  const inventory = new Inventory(store, auth);
  const pos = new POS(store, auth, inventory);
  store.db.transaction(() => {
    const categories = [
      ['Rice & grains', 'සහල් සහ ධාන්‍ය'],
      ['Pulses & sugar', 'පරිප්පු සහ සීනි'],
      ['Tea & spices', 'තේ සහ කුළුබඩු'],
      ['Biscuits & snacks', 'බිස්කට් සහ කෙටි කෑම'],
      ['Household', 'ගෘහ භාණ්ඩ'],
      ['Dairy & beverages', 'කිරි සහ බීම'],
    ].map(([name_en, name_si]) => store.insert('categories', { name_en, name_si }));
    const suppliers = [
      ['Lanka Rice Distributors', '0112345678', 'Colombo', 14],
      ['Ceylon Grocery Traders', '0812345678', 'Kandy', 30],
      ['Hill Country Tea & Spices', '0522234567', 'Nuwara Eliya', 14],
      ['Island Consumer Goods', '0332234567', 'Gampaha', 21],
      ['Fresh Dairy Lanka', '0372234567', 'Kurunegala', 7],
    ].map(([name, phone, address, days]) =>
      store.insert('suppliers', { name, phone, address, credit_days: days }),
    );
    const customers = [
      'Nimal Perera',
      'Kamal Silva',
      'Saman Kumara',
      'Dilani Fernando',
      'Sunil Jayasinghe',
      'Ayesha Mohamed',
      'Tharushi Dissanayake',
      'Ruwan Bandara',
      'Malini Senanayake',
      'Kasun Herath',
    ].map((name, i) =>
      store.insert('customers', {
        name,
        phone: `077${String(1000001 + i)}`,
        address: ['Colombo', 'Kandy', 'Kurunegala'][i % 3],
        join_date: localDate(new Date()),
        credit_limit: (i + 1) * 500000,
      }),
    );
    const data: [string, string, number, string, number, number, number][] = [
      ['Nadu rice', 'නාඩු සහල්', 0, 'kg', 230, 200, 0],
      ['Samba rice', 'සම්බා සහල්', 0, 'kg', 260, 225, 0],
      ['Keeri samba rice', 'කීරි සම්බා සහල්', 0, 'kg', 340, 295, 0],
      ['Red raw rice', 'රතු කැකුළු සහල්', 0, 'kg', 220, 185, 0],
      ['White raw rice', 'සුදු කැකුළු සහල්', 0, 'kg', 225, 190, 0],
      ['Wheat flour', 'තිරිඟු පිටි', 0, 'kg', 195, 160, 1],
      ['Red dhal', 'රතු පරිප්පු', 1, 'kg', 320, 265, 1],
      ['White sugar', 'සුදු සීනි', 1, 'kg', 285, 245, 1],
      ['Brown sugar', 'දුඹුරු සීනි', 1, 'kg', 310, 270, 1],
      ['Green gram', 'මුං ඇට', 1, 'kg', 850, 730, 1],
      ['Chickpeas', 'කඩල', 1, 'kg', 650, 550, 1],
      ['Coconut', 'පොල්', 1, 'pcs', 160, 125, 1],
      ['Ceylon tea 200g', 'ලංකා තේ 200g', 2, 'pack', 480, 390, 2],
      ['Chilli powder 100g', 'මිරිස් කුඩු 100g', 2, 'pack', 190, 145, 2],
      ['Curry powder 100g', 'තුනපහ කුඩු 100g', 2, 'pack', 180, 135, 2],
      ['Turmeric 50g', 'කහ කුඩු 50g', 2, 'pack', 220, 165, 2],
      ['Black pepper 50g', 'ගම්මිරිස් 50g', 2, 'pack', 195, 150, 2],
      ['Salt 1kg', 'ලුණු 1kg', 2, 'pack', 120, 85, 1],
      ['Cinnamon 50g', 'කුරුඳු 50g', 2, 'pack', 260, 200, 2],
      ['Cream crackers 190g', 'ක්‍රීම් ක්‍රැකර් 190g', 3, 'pack', 230, 185, 3],
      ['Marie biscuits 200g', 'මාරි බිස්කට් 200g', 3, 'pack', 200, 160, 3],
      ['Chocolate biscuits 100g', 'චොකලට් බිස්කට් 100g', 3, 'pack', 180, 140, 3],
      ['Lemon puff 200g', 'ලෙමන් පෆ් 200g', 3, 'pack', 290, 230, 3],
      ['Ginger biscuits 100g', 'ඉඟුරු බිස්කට් 100g', 3, 'pack', 170, 130, 3],
      ['Potato chips 50g', 'අල පෙති 50g', 3, 'pack', 160, 115, 3],
      ['Bath soap 100g', 'නාන සබන් 100g', 4, 'pcs', 180, 140, 3],
      ['Laundry soap 115g', 'රෙදි සබන් 115g', 4, 'pcs', 140, 105, 3],
      ['Washing powder 1kg', 'රෙදි සෝදන කුඩු 1kg', 4, 'pack', 520, 430, 3],
      ['Toothpaste 120g', 'දන්තාලේප 120g', 4, 'pcs', 310, 245, 3],
      ['Dishwash liquid 500ml', 'පිඟන් සෝදන දියර 500ml', 4, 'pcs', 350, 270, 3],
      ['Tissue box', 'ටිෂූ පෙට්ටිය', 4, 'pcs', 250, 185, 3],
      ['Fresh milk 1l', 'නැවුම් කිරි 1l', 5, 'pcs', 480, 395, 4],
      ['Yoghurt 80g', 'යෝගට් 80g', 5, 'pcs', 80, 60, 4],
      ['Milk powder 400g', 'කිරි පිටි 400g', 5, 'pack', 1150, 1030, 4],
      ['Drinking water 1.5l', 'පානීය ජලය 1.5l', 5, 'pcs', 130, 90, 3],
      ['Ginger beer 400ml', 'ජින්ජර් බියර් 400ml', 5, 'pcs', 180, 135, 3],
      ['Orange drink 1l', 'දොඩම් බීම 1l', 5, 'pcs', 380, 295, 3],
      ['Coconut milk 180ml', 'පොල් කිරි 180ml', 5, 'pack', 190, 145, 1],
      ['Butter 200g', 'බටර් 200g', 5, 'pcs', 620, 510, 4],
      ['Cheese wedges 120g', 'චීස් කැබලි 120g', 5, 'pack', 690, 580, 4],
    ];
    const products = data.map(([en, si, category, unit, price, cost, supplier], i) => {
      const id = store.insert('products', {
        sku: String(10001 + i),
        name_en: en,
        name_si: si,
        category_id: categories[category],
        unit,
        selling_price: price * 100,
        cost_price: cost * 100,
        mrp: price * 100,
        reorder_level: unit === 'kg' ? 20 : 10,
        quick_access: Number([0, 5, 6, 7, 11, 19, 25, 31, 32, 34].includes(i)),
        supplier_id: suppliers[supplier],
      });
      store.insert('product_barcodes', { product_id: id, barcode: `479000${String(1000001 + i)}` });
      return { id, unit, cost: cost * 100, supplier };
    });
    const cashier = store.insert('users', {
      username: 'cashier',
      display_name: 'Nimali',
      password_hash: bcrypt.hashSync('cashier123', 12),
      role: 'cashier',
      must_change_password: 1,
    });
    const start = new Date();
    start.setDate(start.getDate() - 35);
    for (const [supplierIndex, supplier] of suppliers.entries()) {
      const purchaseId = store.insert('purchases', {
        supplier_id: supplier,
        invoice_no: `DEMO-GRN-${supplierIndex + 1}`,
        date: localDate(start),
        total: 0,
      });
      let total = 0;
      products.forEach((p, i) => {
        if (p.supplier !== supplierIndex) return;
        const quantity = i === 32 ? 450 : p.unit === 'kg' ? 400 : 180;
        const expiry = new Date();
        expiry.setDate(expiry.getDate() + (i === 32 ? 8 : i === 38 ? 20 : i === 23 ? -2 : 180));
        const batch = inventory.newBatch(
          p.id,
          quantity,
          p.cost,
          localDate(expiry),
          purchaseId,
          owner,
          'purchase',
          localDate(start),
        );
        store.insert('purchase_items', {
          purchase_id: purchaseId,
          product_id: p.id,
          batch_id: batch,
          qty: quantity,
          cost_price: p.cost,
        });
        total += Math.round(quantity * p.cost);
      });
      store.update('purchases', purchaseId, { total });
      store.insert('supplier_payments', {
        supplier_id: supplier,
        amount: Math.round(total * 0.7),
        note: 'Demo payment',
        date: localDate(start),
      });
    }
    // Historical records use the exact same sale and stock transaction logic as live billing.
    const was = store.get(
      'SELECT must_change_password FROM users WHERE id=?',
      owner,
    )!.must_change_password;
    store.update('users', owner, { must_change_password: 0 });
    auth.userId = owner;
    pos.shift('start');
    let randomState = 71;
    const random = () => {
      randomState = (randomState * 16807) % 2147483647;
      return randomState / 2147483647;
    };
    for (let day = 27; day >= 0; day--) {
      const d = new Date();
      d.setDate(d.getDate() - day);
      for (let bill = 0; bill < 5 + Math.floor(random() * 5); bill++) {
        const selected = new Set<number>();
        while (selected.size < 2 + Math.floor(random() * 5))
          selected.add(Math.floor(random() * products.length));
        const lines = [...selected]
          .filter((i) => i !== 23)
          .map((i) => ({
            product_id: products[i].id,
            qty:
              products[i].unit === 'kg'
                ? Math.round((0.5 + random() * 2) * 1000) / 1000
                : 1 + Math.floor(random() * 2),
            discount_percent: 0,
          }));
        if (!lines.length) continue;
        pos.saveCart({
          lines,
          customer_id: random() > 0.6 ? customers[Math.floor(random() * 10)] : null,
          discount_type: 'percent',
          discount_value: 0,
          bag_qty: 0,
          redeem_points: 0,
        });
        const { cartTotals } = requireCalculations;
        const totals = cartTotals(
          pos.loadCart(),
          inventory.byIds(lines.map((l) => l.product_id)),
          store.settings(),
        );
        const method = random() > 0.65 ? 'card' : 'cash';
        const result = pos.checkout({
          request_id: uid(),
          payments: [
            {
              method,
              amount: totals.total,
              tendered: totals.total,
              reference: method === 'card' ? 'DEMO' : '',
            },
          ],
        });
        d.setHours(8 + Math.floor(random() * 12), Math.floor(random() * 60), 0, 0);
        const timestamp = d.toISOString();
        store.run(
          'UPDATE sales SET created_at=?,updated_at=?,user_id=? WHERE id=?',
          timestamp,
          timestamp,
          bill % 2 ? cashier : owner,
          result.id,
        );
        store.run(
          'UPDATE sale_items SET created_at=?,updated_at=? WHERE sale_id=?',
          timestamp,
          timestamp,
          result.id,
        );
        store.run(
          'UPDATE payments SET created_at=?,updated_at=? WHERE sale_id=?',
          timestamp,
          timestamp,
          result.id,
        );
      }
    }
    pos.shift('end');
    // Give each staff member a correctly attributed historical daily shift.
    for (const group of store.all(
      "SELECT user_id,date(created_at,'localtime') day,MIN(created_at) first_sale,MAX(created_at) last_sale FROM sales GROUP BY user_id,date(created_at,'localtime')",
    )) {
      const shift = store.insert('shifts', {
        user_id: String(group.user_id),
        start_time: String(group.first_sale),
        end_time: new Date(Date.parse(String(group.last_sale)) + 300000).toISOString(),
      });
      store.run(
        "UPDATE sales SET shift_id=? WHERE user_id=? AND date(created_at,'localtime')=?",
        shift,
        String(group.user_id),
        String(group.day),
      );
    }
    store.run('DELETE FROM shifts WHERE NOT EXISTS (SELECT 1 FROM sales WHERE shift_id=shifts.id)');
    const low = products[24];
    const lowBatch = store.get(
      'SELECT id,qty FROM batches WHERE product_id=? AND qty>5 LIMIT 1',
      low.id,
    );
    if (lowBatch)
      inventory.movement(
        low.id,
        String(lowBatch.id),
        5 - Number(lowBatch.qty),
        'correction',
        null,
        owner,
      );
    store.update('users', owner, { must_change_password: Number(was) });
    auth.userId = null;
    for (let i = 0; i < 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i * 4);
      store.insert('expenses', {
        date: localDate(d),
        amount: [350000, 65000, 120000, 48000, 200000, 95000, 40000][i],
        note: [
          'Electricity bill',
          'Cleaning supplies',
          'Delivery transport',
          'Stationery',
          'Store maintenance',
          'Water bill',
          'Packaging supplies',
        ][i],
      });
    }
    store.insert('cheques', {
      supplier_id: suppliers[0],
      number: '003281',
      bank: 'Commercial Bank',
      amount: 1500000,
      due_date: localDate(new Date(Date.now() + 3 * 86400000)),
      status: 'pending',
    });
    store.audit(owner, 'demoSeed', null, { products: products.length, at: now() });
  })();
}
import * as requireCalculations from '../services/calculations';

import type { z } from 'zod';
import { Store, now, today } from '../db/database';
import { productSchema, schemas } from '../shared/contracts';
import type { Product } from '../shared/types';
import { Auth } from './auth';
import { AppError, requireValue } from './errors';
import { roundQty } from './calculations';
export class Inventory {
  constructor(
    public store: Store,
    public auth: Auth,
  ) {}
  search(query = '', limit = 100, active = true): Product[] {
    const user = this.auth.current();
    const term = query.trim();
    const condition = active ? 'p.active=1' : '1=1';
    const select = `SELECT p.id,p.sku,p.name_en,p.name_si,p.category_id,c.name_en category_en,c.name_si category_si,p.unit,p.selling_price,p.mrp,p.reorder_level,p.active,p.quick_access,p.image,COALESCE((SELECT barcode FROM product_barcodes WHERE product_id=p.id ORDER BY created_at,id LIMIT 1),'') barcode,COALESCE((SELECT ROUND(SUM(qty),3) FROM batches WHERE product_id=p.id),0) stock${user.role === 'owner' ? ',p.cost_price,p.supplier_id' : ''} FROM products p JOIN categories c ON c.id=p.category_id`;
    if (term) {
      const exact = this.store.all<Product>(
        `${select} WHERE ${condition} AND (p.sku=? OR p.id IN (SELECT product_id FROM product_barcodes WHERE barcode=?)) LIMIT ?`,
        term,
        term,
        limit,
      );
      if (exact.length) return exact;
    }
    const pattern = term.replace(/[\\%_]/g, '\\$&') + '%';
    return this.store.all<Product>(
      `${select} WHERE ${condition} AND (p.name_en LIKE ? ESCAPE '\\' OR p.name_si LIKE ? ESCAPE '\\' OR p.sku LIKE ? ESCAPE '\\' OR p.id IN (SELECT product_id FROM product_barcodes WHERE barcode LIKE ? ESCAPE '\\')) ORDER BY p.quick_access DESC,p.name_en LIMIT ?`,
      term ? '%' + pattern : pattern,
      term ? '%' + pattern : pattern,
      pattern,
      pattern,
      limit,
    );
  }
  byIds(ids: string[]): Product[] {
    if (!ids.length) return [];
    return this.store.all<Product>(
      `SELECT p.*,c.name_en category_en,c.name_si category_si,COALESCE((SELECT barcode FROM product_barcodes WHERE product_id=p.id LIMIT 1),'') barcode,COALESCE((SELECT ROUND(SUM(qty),3) FROM batches WHERE product_id=p.id),0) stock FROM products p JOIN categories c ON p.category_id=c.id WHERE p.id IN (${ids.map(() => '?').join(',')})`,
      ...ids,
    );
  }
  save(input: z.infer<typeof productSchema>) {
    const user = this.auth.owner();
    const { id, barcodes, ...data } = input;
    if (new Set(barcodes).size !== barcodes.length) throw new AppError('duplicateBarcode');
    return this.store.db.transaction(() => {
      if (id) {
        const previous = requireValue(this.store.get('SELECT * FROM products WHERE id=?', id));
        if (previous.selling_price !== data.selling_price)
          this.store.audit(user.id, 'priceChange', id, {
            before: previous.selling_price,
            after: data.selling_price,
          });
        this.store.update('products', id, {
          ...data,
          active: Number(data.active),
          quick_access: Number(data.quick_access),
        });
        this.store.run('DELETE FROM product_barcodes WHERE product_id=?', id);
      }
      const result =
        id ??
        this.store.insert('products', {
          ...data,
          active: Number(data.active),
          quick_access: Number(data.quick_access),
        });
      for (const barcode of barcodes)
        this.store.insert('product_barcodes', { product_id: result, barcode });
      this.store.audit(user.id, 'productSaved', result);
      return result;
    })();
  }
  movement(
    productId: string,
    batchId: string,
    quantity: number,
    reason: string,
    reference: string | null,
    userId: string | null,
  ) {
    const batch = requireValue(
      this.store.get('SELECT qty FROM batches WHERE id=? AND product_id=?', batchId, productId),
    );
    const next = roundQty(Number(batch.qty) + quantity);
    if (next < 0 && quantity < 0 && !this.store.settings().allow_negative)
      throw new AppError('insufficientStock');
    this.store.update('batches', batchId, { qty: next });
    this.store.insert('stock_movements', {
      product_id: productId,
      batch_id: batchId,
      qty: quantity,
      reason,
      reference_id: reference,
      user_id: userId,
    });
  }
  newBatch(
    productId: string,
    quantity: number,
    cost: number,
    expiry: string | null,
    purchaseId: string | null,
    userId: string | null,
    reason = 'received',
    receivedDate = today(),
  ) {
    const id = this.store.insert('batches', {
      product_id: productId,
      purchase_id: purchaseId,
      qty: 0,
      cost_price: cost,
      expiry_date: expiry,
      received_date: receivedDate,
    });
    this.movement(productId, id, quantity, reason, purchaseId, userId);
    return id;
  }
  batches(productId: string) {
    this.auth.owner();
    return this.store.all(
      'SELECT * FROM batches WHERE product_id=? ORDER BY expiry_date IS NULL,expiry_date,received_date',
      productId,
    );
  }
  adjust(data: z.infer<typeof schemas.adjustStock>) {
    const user = this.auth.owner();
    return this.store.db.transaction(() => {
      requireValue(this.store.get('SELECT id FROM products WHERE id=?', data.product_id));
      if (data.qty > 0 && !data.batch_id)
        this.newBatch(
          data.product_id,
          data.qty,
          data.cost_price,
          data.expiry_date,
          null,
          user.id,
          'adjustment',
        );
      else {
        if (!data.batch_id) throw new AppError('batchRequired');
        this.movement(data.product_id, data.batch_id, data.qty, data.reason, null, user.id);
      }
      this.store.audit(user.id, 'stockAdjustment', data.product_id, { ...data });
      return true;
    })();
  }
  purchase(data: z.infer<typeof schemas.purchase>) {
    const user = this.auth.owner();
    return this.store.db.transaction(() => {
      const total = data.items.reduce((s, i) => s + Math.round(i.qty * i.cost_price), 0);
      const id = this.store.insert('purchases', {
        supplier_id: data.supplier_id,
        invoice_no: data.invoice_no,
        date: data.date,
        total,
      });
      for (const item of data.items) {
        requireValue(
          this.store.get('SELECT id FROM products WHERE id=? AND active=1', item.product_id),
          'productUnavailable',
        );
        const batchId = this.newBatch(
          item.product_id,
          item.qty,
          item.cost_price,
          item.expiry_date,
          id,
          user.id,
          'purchase',
          data.date,
        );
        this.store.insert('purchase_items', {
          purchase_id: id,
          product_id: item.product_id,
          batch_id: batchId,
          qty: item.qty,
          cost_price: item.cost_price,
        });
        this.store.update('products', item.product_id, {
          cost_price: item.cost_price,
          supplier_id: data.supplier_id,
        });
      }
      this.store.audit(user.id, 'purchase', id, { total });
      return id;
    })();
  }
  alerts() {
    const s = this.store.settings();
    const scalar = (sql: string, ...params: (string | number)[]) =>
      Number(this.store.get(sql, ...params)?.n ?? 0);
    return {
      low: scalar(
        'SELECT COUNT(*) n FROM products p WHERE active=1 AND COALESCE((SELECT SUM(qty) FROM batches WHERE product_id=p.id),0)<=reorder_level',
      ),
      expiring: scalar(
        'SELECT COUNT(*) n FROM batches WHERE qty>0 AND expiry_date BETWEEN date(?) AND date(?, ?)',
        today(),
        today(),
        `+${s.expiry_days} days`,
      ),
      expired: scalar(
        'SELECT COUNT(*) n FROM batches WHERE qty>0 AND expiry_date<date(?)',
        today(),
      ),
      cheques: scalar(
        "SELECT COUNT(*) n FROM cheques WHERE status='pending' AND due_date<=date(?, '+7 days')",
        today(),
      ),
      backup_overdue: !s.last_backup || Date.now() - Date.parse(s.last_backup) > 3 * 86400000,
    };
  }
  assertLedger() {
    return this.store.all(
      'SELECT b.id,b.qty,ROUND(COALESCE(SUM(m.qty),0),3) ledger FROM batches b LEFT JOIN stock_movements m ON m.batch_id=b.id GROUP BY b.id HAVING ABS(b.qty-ROUND(COALESCE(SUM(m.qty),0),3))>0.0001',
    );
  }
  touch() {
    this.store.run('UPDATE products SET updated_at=? WHERE 0', now());
  }
}

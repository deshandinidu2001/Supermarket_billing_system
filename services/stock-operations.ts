import type { z } from 'zod';
import { schemas } from '../shared/contracts';
import { today } from '../db/database';
import { Inventory } from './inventory';
import { AppError, requireValue } from './errors';
import { returnAmount, roundQty } from './calculations';

export class StockOperations {
  constructor(public inventory: Inventory) {}
  get store() {
    return this.inventory.store;
  }
  owner() {
    return this.inventory.auth.owner();
  }
  stocktakes() {
    this.owner();
    return this.store.all(
      'SELECT s.*,u.display_name cashier,(SELECT COUNT(*) FROM stocktake_lines WHERE stocktake_id=s.id AND counted_qty IS NOT NULL) counted FROM stocktakes s JOIN users u ON u.id=s.user_id ORDER BY s.rowid DESC',
    );
  }
  startStocktake() {
    const user = this.owner();
    return this.store.db.transaction(() => {
      const id = this.store.insert('stocktakes', { user_id: user.id, status: 'draft' });
      for (const product of this.store.all(
        'SELECT p.id,ROUND(COALESCE(SUM(b.qty),0),3) stock FROM products p LEFT JOIN batches b ON b.product_id=p.id WHERE p.active=1 GROUP BY p.id',
      ))
        this.store.insert('stocktake_lines', {
          stocktake_id: id,
          product_id: product.id,
          expected_qty: product.stock,
          counted_qty: null,
        });
      this.store.audit(user.id, 'stocktakeStarted', id);
      return id;
    })();
  }
  stocktake(id: string) {
    this.owner();
    return {
      session: requireValue(this.store.get('SELECT * FROM stocktakes WHERE id=?', id)),
      lines: this.store.all(
        'SELECT l.*,p.name_en,p.name_si,p.sku,p.unit FROM stocktake_lines l JOIN products p ON p.id=l.product_id WHERE stocktake_id=? ORDER BY p.name_en',
        id,
      ),
    };
  }
  saveStocktake(input: z.infer<typeof schemas.saveStocktake>) {
    const user = this.owner();
    return this.store.db.transaction(() => {
      const session = requireValue(this.store.get('SELECT * FROM stocktakes WHERE id=?', input.id));
      if (session.status === 'completed') {
        if (input.complete) return true;
        throw new AppError('stocktakeCompleted');
      }
      if (new Set(input.counts.map((line) => line.product_id)).size !== input.counts.length)
        throw new AppError('duplicateLine');
      for (const count of input.counts) {
        const line = requireValue(
          this.store.get(
            'SELECT l.id,p.unit FROM stocktake_lines l JOIN products p ON p.id=l.product_id WHERE stocktake_id=? AND product_id=?',
            input.id,
            count.product_id,
          ),
        );
        if (
          count.counted_qty != null &&
          ['pcs', 'pack'].includes(String(line.unit)) &&
          !Number.isInteger(count.counted_qty)
        )
          throw new AppError('wholeQuantity');
        this.store.update('stocktake_lines', String(line.id), { counted_qty: count.counted_qty });
      }
      if (input.complete) {
        const lines = this.store.all(
          'SELECT * FROM stocktake_lines WHERE stocktake_id=? AND counted_qty IS NOT NULL',
          input.id,
        );
        if (!lines.length) throw new AppError('countRequired');
        for (const line of lines) {
          const product = requireValue(this.inventory.byIds([String(line.product_id)])[0]);
          if (Math.abs(product.stock - Number(line.expected_qty)) > 0.0001)
            throw new AppError('stockChangedDuringCount');
          const delta = roundQty(Number(line.counted_qty) - product.stock);
          if (delta > 0)
            this.inventory.newBatch(
              product.id,
              delta,
              product.cost_price ?? 0,
              null,
              null,
              user.id,
              'stocktake',
            );
          if (delta < 0) {
            let remaining = -delta;
            const batches = this.store.all(
              'SELECT id,qty FROM batches WHERE product_id=? AND qty>0 ORDER BY expiry_date IS NULL,expiry_date,received_date,id',
              product.id,
            );
            for (const batch of batches) {
              const take = Math.min(remaining, Number(batch.qty));
              if (take > 0)
                this.inventory.movement(
                  product.id,
                  String(batch.id),
                  -take,
                  'stocktake',
                  input.id,
                  user.id,
                );
              remaining = roundQty(remaining - take);
            }
            if (remaining > 0.0001) throw new AppError('insufficientStock');
          }
        }
        this.store.update('stocktakes', input.id, { status: 'completed' });
        this.store.audit(user.id, 'stocktakeCompleted', input.id, { counted: lines.length });
      }
      return true;
    })();
  }
  supplierReturnBatches(supplierId: string) {
    this.owner();
    return this.store.all(
      `SELECT b.id batch_id,b.product_id,p.name_en,p.name_si,p.unit,b.qty stock,b.cost_price,b.expiry_date,pu.invoice_no,
      MAX(0,MIN(b.qty,pi.qty-COALESCE((SELECT SUM(qty) FROM supplier_return_items WHERE batch_id=b.id),0))) available
      FROM batches b JOIN purchase_items pi ON pi.batch_id=b.id JOIN purchases pu ON pu.id=b.purchase_id JOIN products p ON p.id=b.product_id
      WHERE pu.supplier_id=? AND b.qty>0 ORDER BY p.name_en,b.received_date`,
      supplierId,
    );
  }
  supplierReturns() {
    this.owner();
    return this.store.all(
      'SELECT r.*,s.name supplier FROM supplier_returns r JOIN suppliers s ON s.id=r.supplier_id ORDER BY r.rowid DESC',
    );
  }
  supplierReturnDetails(id: string) {
    this.owner();
    return {
      record: requireValue(
        this.store.get(
          'SELECT r.*,s.name supplier FROM supplier_returns r JOIN suppliers s ON s.id=r.supplier_id WHERE r.id=?',
          id,
        ),
      ),
      items: this.store.all(
        'SELECT i.*,p.name_en,p.name_si,p.unit,pu.invoice_no FROM supplier_return_items i JOIN products p ON p.id=i.product_id JOIN batches b ON b.id=i.batch_id JOIN purchases pu ON pu.id=b.purchase_id WHERE return_id=?',
        id,
      ),
    };
  }
  supplierReturn(input: z.infer<typeof schemas.supplierReturn>) {
    const user = this.owner();
    return this.store.db.transaction(() => {
      const previous = this.store.get(
        'SELECT id FROM supplier_returns WHERE request_id=?',
        input.request_id,
      );
      if (previous) return String(previous.id);
      if (input.date > today()) throw new AppError('invalidDate');
      requireValue(this.store.get('SELECT id FROM suppliers WHERE id=?', input.supplier_id));
      if (new Set(input.items.map((line) => line.batch_id)).size !== input.items.length)
        throw new AppError('duplicateLine');
      const id = this.store.insert('supplier_returns', {
        request_id: input.request_id,
        supplier_id: input.supplier_id,
        user_id: user.id,
        date: input.date,
        reason: input.reason,
        total: 0,
      });
      let total = 0;
      for (const item of input.items) {
        const batch = requireValue(
          this.store.get(
            `SELECT b.*,p.unit,pi.qty purchased_qty,COALESCE((SELECT SUM(qty) FROM supplier_return_items WHERE batch_id=b.id),0) returned_qty
          FROM batches b JOIN purchase_items pi ON pi.batch_id=b.id JOIN purchases pu ON pu.id=b.purchase_id JOIN products p ON p.id=b.product_id WHERE b.id=? AND pu.supplier_id=?`,
            item.batch_id,
            input.supplier_id,
          ),
        );
        if (['pcs', 'pack'].includes(String(batch.unit)) && !Number.isInteger(item.qty))
          throw new AppError('wholeQuantity');
        if (
          item.qty > Number(batch.qty) ||
          roundQty(item.qty + Number(batch.returned_qty)) > Number(batch.purchased_qty)
        )
          throw new AppError('insufficientStock');
        const amount = returnAmount(
          Math.round(Number(batch.purchased_qty) * Number(batch.cost_price)),
          Number(batch.purchased_qty),
          Number(batch.returned_qty),
          item.qty,
        );
        this.inventory.movement(
          String(batch.product_id),
          item.batch_id,
          -item.qty,
          'supplierReturn',
          id,
          user.id,
        );
        this.store.insert('supplier_return_items', {
          return_id: id,
          batch_id: item.batch_id,
          product_id: batch.product_id,
          qty: item.qty,
          cost_price: batch.cost_price,
          amount,
        });
        total += amount;
      }
      this.store.update('supplier_returns', id, { total });
      this.store.audit(user.id, 'supplierReturn', id, { total });
      return id;
    })();
  }
}

import { z } from 'zod';
import { Store, now, today, uid } from '../db/database';
import { cartSchema, schemas } from '../shared/contracts';
import { emptyCart, type Cart, type Receipt } from '../shared/types';
import { Auth } from './auth';
import { Inventory } from './inventory';
import {
  allocate,
  checkDiscount,
  fifo,
  returnAmount,
  roundQty,
  validatePayments,
  type Batch,
} from './calculations';
import { AppError, requireValue } from './errors';
export class POS {
  constructor(
    public store: Store,
    public auth: Auth,
    public inventory: Inventory,
  ) {}
  loadCart(): Cart {
    const user = this.auth.current();
    const row = this.store.get(
      "SELECT cart FROM held_bills WHERE user_id=? AND status='open'",
      user.id,
    );
    return row ? cartSchema.parse(JSON.parse(String(row.cart))) : emptyCart();
  }
  saveCart(cart: Cart) {
    const user = this.auth.current();
    const products = this.inventory.byIds(cart.lines.map((l) => l.product_id));
    if (new Set(cart.lines.map((l) => l.product_id)).size !== cart.lines.length)
      throw new AppError('duplicateLine');
    if (products.some((p) => !p.active)) throw new AppError('productUnavailable');
    checkDiscount(user.role, cart, products, this.store.settings());
    const row = this.store.get(
      "SELECT id FROM held_bills WHERE user_id=? AND status='open'",
      user.id,
    );
    if (row) this.store.update('held_bills', String(row.id), { cart: JSON.stringify(cart) });
    else
      this.store.insert('held_bills', {
        user_id: user.id,
        name: '',
        cart: JSON.stringify(cart),
        status: 'open',
      });
    return cart;
  }
  hold(name: string) {
    const user = this.auth.current();
    const cart = this.loadCart();
    if (!cart.lines.length) throw new AppError('emptyCart');
    return this.store.db.transaction(() => {
      const row = requireValue(
        this.store.get("SELECT id FROM held_bills WHERE user_id=? AND status='open'", user.id),
      );
      this.store.update('held_bills', String(row.id), { status: 'held', name });
      this.saveCart(emptyCart());
      return String(row.id);
    })();
  }
  resume(id: string) {
    const user = this.auth.current();
    if (this.loadCart().lines.length) throw new AppError('holdCurrentCart');
    return this.store.db.transaction(() => {
      const row = requireValue(
        this.store.get(
          "SELECT * FROM held_bills WHERE id=? AND user_id=? AND status='held'",
          id,
          user.id,
        ),
      );
      const cart = cartSchema.parse(JSON.parse(String(row.cart)));
      this.saveCart(cart);
      this.store.run('DELETE FROM held_bills WHERE id=?', id);
      return cart;
    })();
  }
  deleteHeld(id: string) {
    const user = this.auth.current();
    this.store.run(
      "DELETE FROM held_bills WHERE id=? AND user_id=? AND status='held'",
      id,
      user.id,
    );
    return true;
  }
  shift(action: 'start' | 'end' | 'summary') {
    const user = this.auth.current();
    let shift =
      this.store.get('SELECT * FROM shifts WHERE user_id=? AND end_time IS NULL', user.id) ?? null;
    if (action === 'start') {
      if (shift) throw new AppError('shiftAlreadyOpen');
      const id = this.store.insert('shifts', {
        user_id: user.id,
        start_time: now(),
        end_time: null,
      });
      shift = this.store.get('SELECT * FROM shifts WHERE id=?', id)!;
      this.store.audit(user.id, 'shiftStarted', id);
    }
    if (action === 'end') {
      if (!shift) throw new AppError('noShift');
      if (this.loadCart().lines.length) throw new AppError('holdCurrentCart');
      this.store.update('shifts', String(shift.id), { end_time: now() });
      shift = this.store.get('SELECT * FROM shifts WHERE id=?', String(shift.id))!;
      this.store.audit(user.id, 'shiftEnded', String(shift.id));
    }
    if (!shift)
      shift =
        this.store.get(
          'SELECT * FROM shifts WHERE user_id=? ORDER BY start_time DESC LIMIT 1',
          user.id,
        ) ?? null;
    if (!shift) return { shift: null, methods: [], bills: 0, returns: 0 };
    const methods = this.store.all(
      'SELECT p.method,SUM(p.amount) amount FROM payments p JOIN sales s ON s.id=p.sale_id WHERE s.shift_id=? GROUP BY p.method',
      String(shift.id),
    );
    const bills = Number(
      this.store.get('SELECT COUNT(*) n FROM sales WHERE shift_id=?', String(shift.id))?.n ?? 0,
    );
    const returns = Number(
      this.store.get(
        'SELECT COALESCE(SUM(total),0) n FROM returns WHERE user_id=? AND created_at>=? AND created_at<=?',
        user.id,
        String(shift.start_time),
        String(shift.end_time ?? now()),
      )?.n ?? 0,
    );
    return { shift, methods, bills, returns };
  }
  checkout(data: z.infer<typeof schemas.checkout>) {
    const user = this.auth.current();
    return this.store.db.transaction(() => {
      const previous = this.store.get('SELECT * FROM sales WHERE request_id=?', data.request_id);
      if (previous) {
        if (previous.user_id !== user.id) throw new AppError('forbidden');
        const payments = this.store.all<{ amount: number; tendered: number; method: string }>(
          'SELECT * FROM payments WHERE sale_id=?',
          String(previous.id),
        );
        return {
          id: String(previous.id),
          bill_no: String(previous.bill_no),
          total: Number(previous.total),
          change: payments
            .filter((p) => p.method === 'cash')
            .reduce((s, p) => s + p.tendered - p.amount, 0),
        };
      }
      const cart = this.loadCart();
      if (!cart.lines.length) throw new AppError('emptyCart');
      const settings = this.store.settings();
      const products = this.inventory.byIds(cart.lines.map((l) => l.product_id));
      if (products.some((p) => !p.active)) throw new AppError('productUnavailable');
      const totals = checkDiscount(user.role, cart, products, settings);
      for (const line of totals.lines)
        if (!['kg', 'g', 'l', 'ml'].includes(line.product.unit) && !Number.isInteger(line.qty))
          throw new AppError('wholeQuantity');
      const change = validatePayments(data.payments, totals.total);
      const shift = requireValue(
        this.store.get('SELECT id FROM shifts WHERE user_id=? AND end_time IS NULL', user.id),
        'startShiftFirst',
      );
      const customer = cart.customer_id
        ? requireValue(this.store.get('SELECT * FROM customers WHERE id=?', cart.customer_id))
        : null;
      const credit = data.payments
        .filter((p) => p.method === 'credit')
        .reduce((s, p) => s + p.amount, 0);
      if ((credit > 0 || cart.redeem_points > 0) && !customer)
        throw new AppError('customerRequired');
      if (customer) {
        if (Number(customer.balance) + credit > Number(customer.credit_limit))
          throw new AppError('creditLimit');
        if (cart.redeem_points > Number(customer.points)) throw new AppError('pointsTooHigh');
      }
      let counter = this.store.get(
        'SELECT * FROM counters WHERE counter_id=?',
        settings.counter_id,
      );
      if (!counter) {
        const counterId = this.store.insert('counters', {
          counter_id: settings.counter_id,
          sequence: 0,
        });
        counter = { id: counterId, sequence: 0 };
      }
      const sequence = Number(counter.sequence) + 1;
      this.store.update('counters', String(counter.id), { sequence });
      const billNo = `${settings.counter_id}-${String(sequence).padStart(6, '0')}`;
      const id = uid();
      let cost = 0;
      const itemRecords: Record<string, string | number | null>[] = [];
      const sharedDiscounts = allocate(
        totals.billDiscount + totals.loyaltyDiscount,
        totals.lines.map((l) => l.net),
      );
      for (const [index, line] of totals.lines.entries()) {
        if (!(settings.allow_negative && user.role === 'owner') && line.product.stock < line.qty)
          throw new AppError('insufficientStock');
        let batches = this.store.all<Batch>(
          'SELECT id,qty,cost_price,expiry_date,received_date FROM batches WHERE product_id=?',
          line.product_id,
        );
        if (settings.allow_negative && user.role === 'owner') {
          const available = batches
            .filter((b) => !b.expiry_date || b.expiry_date >= today())
            .reduce((s, b) => s + Math.max(0, b.qty), 0);
          if (available < line.qty) {
            const shortage = roundQty(line.qty - available);
            const bid = this.inventory.newBatch(
              line.product_id,
              0,
              line.product.cost_price ?? 0,
              null,
              null,
              user.id,
              'negativeOpening',
            );
            batches = [
              ...batches,
              {
                id: bid,
                qty: shortage,
                cost_price: line.product.cost_price ?? 0,
                expiry_date: null,
                received_date: today(),
              },
            ];
          }
        }
        const deduction = fifo(batches, line.qty, today());
        const revenues = allocate(
          line.net - sharedDiscounts[index],
          deduction.map((d) => d.qty),
        );
        const discounts = allocate(
          line.discount + sharedDiscounts[index],
          deduction.map((d) => d.qty),
        );
        const lineId = uid();
        for (const [i, part] of deduction.entries()) {
          const partCost = Math.round(part.qty * part.batch.cost_price);
          cost += partCost;
          this.inventory.movement(line.product_id, part.batch.id, -part.qty, 'sale', id, user.id);
          itemRecords.push({
            sale_id: id,
            product_id: line.product_id,
            batch_id: part.batch.id,
            line_id: lineId,
            name_en: line.product.name_en,
            name_si: line.product.name_si,
            unit: line.product.unit,
            qty: part.qty,
            unit_price: line.product.selling_price,
            unit_cost: part.batch.cost_price,
            discount: discounts[i],
            line_total: revenues[i],
            cost_total: partCost,
          });
        }
      }
      const points = customer
        ? Math.floor((Math.max(0, totals.total - totals.bagTotal) / 10000) * settings.loyalty_earn)
        : 0;
      this.store.insert('sales', {
        id,
        request_id: data.request_id,
        bill_no: billNo,
        counter_id: settings.counter_id,
        user_id: user.id,
        customer_id: cart.customer_id,
        shift_id: String(shift.id),
        subtotal: totals.subtotal,
        line_discount: totals.lineDiscount,
        bill_discount: totals.billDiscount,
        loyalty_discount: totals.loyaltyDiscount,
        bag_total: totals.bagTotal,
        rounding: totals.rounding,
        total: totals.total,
        cost,
        points_earned: points,
        points_redeemed: cart.redeem_points,
      });
      for (const record of itemRecords) this.store.insert('sale_items', record);
      for (const payment of data.payments)
        this.store.insert('payments', { sale_id: id, ...payment });
      if (customer) {
        this.store.update('customers', String(customer.id), {
          balance: Number(customer.balance) + credit,
          points: Number(customer.points) + points - cart.redeem_points,
        });
        if (points)
          this.store.insert('loyalty_transactions', {
            customer_id: String(customer.id),
            sale_id: id,
            return_id: null,
            points,
            note: 'earned',
          });
        if (cart.redeem_points)
          this.store.insert('loyalty_transactions', {
            customer_id: String(customer.id),
            sale_id: id,
            return_id: null,
            points: -cart.redeem_points,
            note: 'redeemed',
          });
      }
      if (totals.lineDiscount + totals.billDiscount > 0)
        this.store.audit(user.id, 'discount', id, {
          amount: totals.lineDiscount + totals.billDiscount,
        });
      this.saveCart(emptyCart());
      this.store.audit(user.id, 'sale', id, { bill_no: billNo, total: totals.total });
      return { id, bill_no: billNo, total: totals.total, change };
    })();
  }
  receipt(billNo: string): Receipt {
    const user = this.auth.current();
    const sale = requireValue(
      this.store.get(
        'SELECT s.*,u.display_name cashier FROM sales s JOIN users u ON u.id=s.user_id WHERE bill_no=?',
        billNo,
      ),
      'billNotFound',
    );
    let items = this.store.all(
      'SELECT i.*,COALESCE((SELECT SUM(qty) FROM return_items WHERE sale_item_id=i.id),0) returned_qty FROM sale_items i WHERE sale_id=? ORDER BY created_at,id',
      String(sale.id),
    );
    if (user.role === 'cashier') {
      delete sale.cost;
      items = items.map(({ unit_cost: _unit_cost, cost_total: _cost_total, ...rest }) => rest);
    }
    return {
      sale,
      items,
      payments: this.store.all(
        'SELECT method,amount,reference,tendered FROM payments WHERE sale_id=?',
        String(sale.id),
      ),
      customer: sale.customer_id
        ? (this.store.get(
            'SELECT name,phone FROM customers WHERE id=?',
            String(sale.customer_id),
          ) ?? null)
        : null,
      shop: this.store.settings(),
    };
  }
  returnSale(data: z.infer<typeof schemas.returnSale>) {
    const user = this.auth.current();
    const approver = this.auth.approve(data.owner_pin);
    return this.store.db.transaction(() => {
      const sale = requireValue(this.store.get('SELECT * FROM sales WHERE id=?', data.sale_id));
      if (sale.status === 'void') throw new AppError('alreadyVoided');
      if (new Set(data.items.map((i) => i.sale_item_id)).size !== data.items.length)
        throw new AppError('duplicateLine');
      const id = uid();
      let total = 0,
        cost = 0;
      const records: Record<string, string | number | null>[] = [];
      for (const item of data.items) {
        const original = requireValue(
          this.store.get(
            'SELECT * FROM sale_items WHERE id=? AND sale_id=?',
            item.sale_item_id,
            data.sale_id,
          ),
        );
        const returned = Number(
          this.store.get(
            'SELECT COALESCE(SUM(qty),0) qty FROM return_items WHERE sale_item_id=?',
            item.sale_item_id,
          )?.qty ?? 0,
        );
        const amount = returnAmount(
          Number(original.line_total),
          Number(original.qty),
          returned,
          item.qty,
        );
        const costPart = item.damaged
          ? 0
          : returnAmount(Number(original.cost_total), Number(original.qty), returned, item.qty);
        total += amount;
        cost += costPart;
        if (!item.damaged)
          this.inventory.movement(
            String(original.product_id),
            String(original.batch_id),
            item.qty,
            'return',
            id,
            user.id,
          );
        records.push({
          return_id: id,
          sale_item_id: item.sale_item_id,
          qty: item.qty,
          damaged: Number(item.damaged),
          amount,
          cost: costPart,
        });
      }
      const remaining =
        Number(
          this.store.get(
            'SELECT COALESCE(SUM(qty),0) qty FROM sale_items WHERE sale_id=?',
            data.sale_id,
          )?.qty ?? 0,
        ) -
        Number(
          this.store.get(
            'SELECT COALESCE(SUM(ri.qty),0) qty FROM return_items ri JOIN sale_items si ON si.id=ri.sale_item_id WHERE si.sale_id=?',
            data.sale_id,
          )?.qty ?? 0,
        ) -
        data.items.reduce((s, i) => s + i.qty, 0);
      const full = roundQty(remaining) === 0;
      if (data.void && !full) throw new AppError('voidAllItems');
      const previousTotal = Number(
        this.store.get('SELECT COALESCE(SUM(total),0) n FROM returns WHERE sale_id=?', data.sale_id)
          ?.n ?? 0,
      );
      if (full) total = Number(sale.total) - previousTotal;
      const customer = sale.customer_id
        ? this.store.get('SELECT * FROM customers WHERE id=?', String(sale.customer_id))
        : null;
      const originalCredit = Number(
        this.store.get(
          "SELECT COALESCE(SUM(amount),0) n FROM payments WHERE sale_id=? AND method='credit'",
          data.sale_id,
        )?.n ?? 0,
      );
      const previousCredit = Number(
        this.store.get(
          'SELECT COALESCE(SUM(credit_amount),0) n FROM returns WHERE sale_id=?',
          data.sale_id,
        )?.n ?? 0,
      );
      const creditAmount = customer
        ? Math.min(
            total,
            Math.max(0, originalCredit - previousCredit),
            Math.max(0, Number(customer.balance)),
          )
        : 0;
      if (data.method === 'credit' && creditAmount !== total)
        throw new AppError('creditRefundLimit');
      if (customer && creditAmount > 0)
        this.store.update('customers', String(customer.id), {
          balance: Number(customer.balance) - creditAmount,
        });
      this.store.insert('returns', {
        id,
        sale_id: data.sale_id,
        user_id: user.id,
        approved_by: approver,
        reason: data.reason,
        method: data.method,
        total,
        cost,
        credit_amount: creditAmount,
        is_void: Number(data.void),
      });
      for (const record of records) this.store.insert('return_items', record);
      if (customer) {
        const oldRefund = previousTotal,
          newRefund = previousTotal + total;
        const earned = Number(sale.points_earned),
          redeemed = Number(sale.points_redeemed);
        const pointDelta =
          Number(sale.total) > 0
            ? -(
                Math.round((earned * newRefund) / Number(sale.total)) -
                Math.round((earned * oldRefund) / Number(sale.total))
              ) +
              (Math.round((redeemed * newRefund) / Number(sale.total)) -
                Math.round((redeemed * oldRefund) / Number(sale.total)))
            : full
              ? redeemed - earned
              : 0;
        if (pointDelta) {
          this.store.update('customers', String(customer.id), {
            points: Number(customer.points) + pointDelta,
          });
          this.store.insert('loyalty_transactions', {
            customer_id: String(customer.id),
            sale_id: data.sale_id,
            return_id: id,
            points: pointDelta,
            note: 'returned',
          });
        }
      }
      if (full)
        this.store.update('sales', data.sale_id, { status: data.void ? 'void' : 'returned' });
      else this.store.update('sales', data.sale_id, { status: 'partialReturn' });
      this.store.audit(user.id, data.void ? 'void' : 'return', id, {
        total,
        approved_by: approver,
      });
      return id;
    })();
  }
}

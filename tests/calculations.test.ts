import { describe, expect, it } from 'vitest';
import {
  allocate,
  can,
  cartTotals,
  checkDiscount,
  fifo,
  profit,
  returnAmount,
  roundBill,
  validatePayments,
  scaleBarcode,
} from '../services/calculations';
import { defaults } from '../db/database';
import { emptyCart, type Product } from '../shared/types';
const product = { id: 'p1', selling_price: 23000, unit: 'kg' } as Product;
describe('money and profit', () => {
  it('uses saved costs and subtracts refunds and expenses', () =>
    expect(profit(100000, 60000, 5000, 20000, 12000)).toEqual({
      revenue: 80000,
      cogs: 48000,
      gross_profit: 32000,
      net_profit: 27000,
    }));
  it('rounds to the selected rule', () => {
    expect(roundBill(125249, 'none')).toBe(125249);
    expect(roundBill(125249, '1')).toBe(125200);
    expect(roundBill(125249, '5')).toBe(125000);
    expect(roundBill(125250, '5')).toBe(125500);
  });
  it('allocates every cent, including zero weights', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([33, 34, 33]);
    expect(allocate(101, [0, 0])).toEqual([101, 0]);
  });
  it('calculates weighted lines and compounded discounts', () => {
    const c = {
      ...emptyCart(),
      lines: [{ product_id: 'p1', qty: 1.25, discount_percent: 10 }],
      discount_value: 5,
    };
    const t = cartTotals(c, [product], defaults);
    expect(t.subtotal).toBe(28750);
    expect(t.lineDiscount).toBe(2875);
    expect(t.billDiscount).toBe(1294);
    expect(t.total).toBe(24581);
  });
  it('caps the effective cashier discount including amount discounts', () => {
    const cart = {
      ...emptyCart(),
      lines: [{ product_id: 'p1', qty: 1, discount_percent: 4 }],
      discount_type: 'amount' as const,
      discount_value: 300,
    };
    expect(() => checkDiscount('cashier', cart, [product], defaults)).toThrow('discountLimit');
    expect(() => checkDiscount('owner', cart, [product], defaults)).not.toThrow();
  });
});
describe('inventory and returns', () => {
  const batches = [
    { id: 'a', qty: 2, cost_price: 100, expiry_date: '2026-11-01', received_date: '2026-01-01' },
    { id: 'b', qty: 3, cost_price: 120, expiry_date: '2026-10-30', received_date: '2026-02-01' },
    { id: 'x', qty: 100, cost_price: 50, expiry_date: '2026-10-01', received_date: '2026-01-01' },
  ];
  it('deducts earliest expiry first and skips expired stock', () =>
    expect(fifo(batches, 4, '2026-10-27').map((p) => [p.batch.id, p.qty])).toEqual([
      ['b', 3],
      ['a', 1],
    ]));
  it('rejects shortages without mutating batches', () => {
    expect(() => fifo(batches, 6, '2026-10-27')).toThrow('insufficientStock');
    expect(batches[0].qty).toBe(2);
  });
  it('refunds exactly once across fractional partial returns', () => {
    expect(
      returnAmount(100, 3, 0, 1) + returnAmount(100, 3, 1, 1) + returnAmount(100, 3, 2, 1),
    ).toBe(100);
    expect(() => returnAmount(100, 3, 2, 2)).toThrow('returnQuantity');
  });
  it('decodes scale barcodes', () => {
    const config = { ...defaults, scale_enabled: true };
    expect(scaleBarcode('2210001012507', config, [{ ...product, sku: '10001' }])?.qty).toBe(1.25);
  });
});
describe('payments and permissions', () => {
  it('accepts exact split payments and returns cash change', () =>
    expect(
      validatePayments(
        [
          { method: 'cash', amount: 50000, tendered: 100000, reference: '' },
          { method: 'card', amount: 25000, tendered: 0, reference: '1234' },
        ],
        75000,
      ),
    ).toBe(50000));
  it('rejects incomplete payments and missing references', () => {
    expect(() =>
      validatePayments([{ method: 'cash', amount: 10, tendered: 20, reference: '' }], 11),
    ).toThrow('paymentMismatch');
    expect(() =>
      validatePayments([{ method: 'card', amount: 10, tendered: 0, reference: '' }], 10),
    ).toThrow('referenceRequired');
  });
  it('keeps sensitive operations owner-only', () => {
    for (const action of ['dashboard', 'settings', 'purchase', 'saveProduct', 'backup', 'saveUser'])
      expect(can('cashier', action)).toBe(false);
    expect(can('cashier', 'checkout')).toBe(true);
    expect(can('owner', 'dashboard')).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { measuredQuantity, measurementStep } from '../src/lib/measurement';
import { cartTotals } from '../services/calculations';
import { defaults } from '../db/database';
import { emptyCart, type Product } from '../shared/types';

describe('measured checkout quantities', () => {
  it('converts grams to kilogram pricing and kilograms to gram pricing', () => {
    expect(measuredQuantity(500, 'g', 'kg')).toBe(0.5);
    expect(measuredQuantity(1250, 'g', 'kg')).toBe(1.25);
    expect(measuredQuantity(0.25, 'kg', 'g')).toBe(250);
  });
  it('converts volume with the same precision as saved cart quantities', () => {
    expect(measuredQuantity(750, 'ml', 'l')).toBe(0.75);
    expect(measuredQuantity(1.5, 'l', 'ml')).toBe(1500);
  });
  it('rejects incompatible, nonpositive, nonfinite and excessively large quantities', () => {
    expect(measuredQuantity(1, 'ml', 'kg')).toBeNull();
    for (const value of [0, -1, NaN, Infinity, 1_000_001])
      expect(measuredQuantity(value, 'kg', 'kg')).toBeNull();
  });
  it('rejects amounts that would require silent rounding in the pricing unit', () => {
    expect(measuredQuantity(0.5, 'g', 'kg')).toBeNull();
    expect(measuredQuantity(0.0001, 'kg', 'kg')).toBeNull();
    expect(measuredQuantity(1, 'g', 'kg')).toBe(0.001);
    expect(measurementStep('g', 'kg')).toBe(1);
  });
  it('charges 500 g of rice at Rs. 230 per kg as Rs. 115 in the saved bill', () => {
    const product = { id: 'rice', unit: 'kg', selling_price: 23000 } as Product;
    const cart = {
      ...emptyCart(),
      lines: [
        { product_id: product.id, qty: measuredQuantity(500, 'g', 'kg')!, discount_percent: 0 },
      ],
    };
    expect(cartTotals(cart, [product], defaults).total).toBe(11500);
  });
});

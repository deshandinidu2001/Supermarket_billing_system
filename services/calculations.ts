import type { Cart, Payment, Product, Settings, Role } from '../shared/types';
import { AppError } from './errors';
export const roundMoney = (v: number) => Math.round(v + Number.EPSILON);
export const roundQty = (v: number) => Math.round(v * 1000) / 1000;
export function roundBill(total: number, rule: Settings['rounding']) {
  const step = rule === 'none' ? 1 : rule === '1' ? 100 : 500;
  return Math.round(total / step) * step;
}
export function cartTotals(cart: Cart, products: Product[], settings: Settings) {
  const lines = cart.lines.map((line) => {
    const p = products.find((p) => p.id === line.product_id);
    if (!p) throw new AppError('productUnavailable');
    const gross = roundMoney(p.selling_price * line.qty);
    const discount = roundMoney((gross * line.discount_percent) / 100);
    return { ...line, product: p, gross, discount, net: gross - discount };
  });
  const subtotal = lines.reduce((s, l) => s + l.gross, 0),
    lineDiscount = lines.reduce((s, l) => s + l.discount, 0),
    net = subtotal - lineDiscount;
  if (!Number.isSafeInteger(subtotal) || subtotal > 100_000_000_000)
    throw new AppError('validation');
  const billDiscount =
    cart.discount_type === 'percent'
      ? roundMoney((net * cart.discount_value) / 100)
      : roundMoney(cart.discount_value);
  if (billDiscount > net || (cart.discount_type === 'percent' && cart.discount_value > 100))
    throw new AppError('discountTooHigh');
  const loyaltyDiscount = cart.redeem_points * settings.loyalty_value;
  if (loyaltyDiscount > net - billDiscount) throw new AppError('pointsTooHigh');
  const bagTotal = cart.bag_qty * settings.bag_price;
  const beforeRounding = net - billDiscount - loyaltyDiscount + bagTotal;
  const total = roundBill(beforeRounding, settings.rounding);
  return {
    lines,
    subtotal,
    lineDiscount,
    billDiscount,
    loyaltyDiscount,
    bagTotal,
    rounding: total - beforeRounding,
    total,
  };
}
export function checkDiscount(role: Role, cart: Cart, products: Product[], settings: Settings) {
  const totals = cartTotals(cart, products, settings);
  if (
    role === 'cashier' &&
    totals.subtotal > 0 &&
    ((totals.lineDiscount + totals.billDiscount) / totals.subtotal) * 100 >
      settings.max_discount + 1e-8
  )
    throw new AppError('discountLimit');
  return totals;
}
export function allocate(total: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum) return weights.map((_, i) => (i === 0 ? total : 0));
  let previous = 0,
    cumulative = 0;
  return weights.map((w) => {
    cumulative += w;
    const next = roundMoney((total * cumulative) / sum),
      part = next - previous;
    previous = next;
    return part;
  });
}
export interface Batch {
  id: string;
  qty: number;
  cost_price: number;
  expiry_date: string | null;
  received_date: string;
}
export function fifo(
  batches: Batch[],
  quantity: number,
  date: string,
): { batch: Batch; qty: number }[] {
  const sorted = batches
    .filter((b) => b.qty > 0 && (!b.expiry_date || b.expiry_date >= date))
    .sort(
      (a, b) =>
        (a.expiry_date ?? '9999').localeCompare(b.expiry_date ?? '9999') ||
        a.received_date.localeCompare(b.received_date) ||
        a.id.localeCompare(b.id),
    );
  let remaining = quantity;
  const result: { batch: Batch; qty: number }[] = [];
  for (const batch of sorted) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, batch.qty);
    result.push({ batch, qty: take });
    remaining = roundQty(remaining - take);
  }
  if (remaining > 0) throw new AppError('insufficientStock');
  return result;
}
export function validatePayments(payments: Payment[], total: number) {
  if (payments.reduce((s, p) => s + p.amount, 0) !== total) throw new AppError('paymentMismatch');
  let change = 0;
  for (const p of payments) {
    if (p.method === 'cash') {
      if (p.tendered < p.amount) throw new AppError('insufficientTender');
      change += p.tendered - p.amount;
    } else if (['card', 'qr'].includes(p.method) && !p.reference.trim())
      throw new AppError('referenceRequired');
  }
  return change;
}
export function returnAmount(
  total: number,
  originalQty: number,
  returnedQty: number,
  quantity: number,
) {
  if (quantity <= 0 || roundQty(returnedQty + quantity) > originalQty)
    throw new AppError('returnQuantity');
  return (
    roundMoney((total * (returnedQty + quantity)) / originalQty) -
    roundMoney((total * returnedQty) / originalQty)
  );
}
export function profit(
  revenue: number,
  cost: number,
  expenses: number,
  refunds = 0,
  returnedCost = 0,
) {
  const netRevenue = revenue - refunds,
    cogs = cost - returnedCost;
  return {
    revenue: netRevenue,
    cogs,
    gross_profit: netRevenue - cogs,
    net_profit: netRevenue - cogs - expenses,
  };
}
export function can(role: Role, action: string) {
  return (
    role === 'owner' ||
    [
      'bootstrap',
      'logout',
      'changePassword',
      'language',
      'products',
      // Entity ownership and cashier-safe projections are checked by Management.list.
      'list',
      'loadCart',
      'cartProducts',
      'saveCart',
      'holdCart',
      'resumeCart',
      'deleteHeld',
      'checkout',
      'receipt',
      'returnSale',
      'shift',
      'printReceipt',
    ].includes(action)
  );
}
export function scaleBarcode(value: string, settings: Settings, products: Product[]) {
  if (!settings.scale_enabled || !value.startsWith(settings.scale_prefix)) return null;
  const offset = settings.scale_prefix.length;
  const code = value.slice(offset, offset + settings.scale_item_digits);
  const embedded = value.slice(
    offset + settings.scale_item_digits,
    offset + settings.scale_item_digits + settings.scale_value_digits,
  );
  if (embedded.length !== settings.scale_value_digits || !/^\d+$/.test(embedded)) return null;
  const product = products.find((p) => p.sku === code || p.barcode === code);
  if (!product) return null;
  const number = Number(embedded) / 10 ** settings.scale_decimals;
  const qty =
    settings.scale_mode === 'price'
      ? (number * 100) / product.selling_price
      : product.unit === 'g'
        ? number * 1000
        : number;
  return { product, qty: roundQty(qty) };
}

import { z } from 'zod';

// Explicit export allowlist: never serialize an entire operational record.
export const analyticsColumns = {
  categories: ['id', 'name_en', 'name_si'],
  products: [
    'id',
    'sku',
    'name_en',
    'name_si',
    'category_id',
    'unit',
    'selling_price',
    'cost_price',
    'reorder_level',
    'active',
    'supplier_id',
    'created_at',
  ],
  batches: ['id', 'product_id', 'qty', 'cost_price', 'expiry_date', 'received_date'],
  sales: [
    'id',
    'bill_no',
    'subtotal',
    'line_discount',
    'bill_discount',
    'loyalty_discount',
    'bag_total',
    'rounding',
    'total',
    'cost',
    'status',
    'created_at',
  ],
  sale_items: [
    'id',
    'sale_id',
    'product_id',
    'batch_id',
    'name_en',
    'name_si',
    'unit',
    'qty',
    'unit_price',
    'unit_cost',
    'discount',
    'line_total',
    'cost_total',
    'created_at',
  ],
  payments: ['id', 'sale_id', 'method', 'amount', 'tendered'],
  returns: ['id', 'sale_id', 'method', 'total', 'cost', 'credit_amount', 'is_void', 'created_at'],
  return_items: ['id', 'return_id', 'sale_item_id', 'qty', 'damaged', 'amount', 'cost'],
  stock_movements: ['id', 'product_id', 'batch_id', 'qty', 'created_at'],
  purchases: ['id', 'supplier_id', 'date', 'total'],
  purchase_items: ['id', 'purchase_id', 'product_id', 'batch_id', 'qty', 'cost_price'],
  supplier_returns: ['id', 'supplier_id', 'date', 'total'],
  supplier_return_items: [
    'id',
    'return_id',
    'batch_id',
    'product_id',
    'qty',
    'cost_price',
    'amount',
  ],
  supplier_payments: ['id', 'supplier_id', 'amount', 'date'],
  suppliers: ['id', 'name'],
  customers: ['id', 'balance', 'credit_limit', 'points'],
  expenses: ['id', 'date', 'amount'],
  settings: ['id', 'shop_name', 'expiry_days', 'dead_stock_days'],
} as const;
export type AnalyticsTable = keyof typeof analyticsColumns;
export type AnalyticsRow = Record<string, string | number | null>;
export type Dataset = Partial<Record<AnalyticsTable, AnalyticsRow[]>>;
export const eventSchema = z
  .object({
    id: z.string().uuid(),
    sequence: z.number().int().positive(),
    schema: z.literal(1),
    storeId: z.string().uuid(),
    deviceId: z.string().uuid(),
    epoch: z.string().uuid(),
    table: z
      .enum(Object.keys(analyticsColumns) as [AnalyticsTable, ...AnalyticsTable[]])
      .nullable(),
    recordId: z.string().max(100),
    kind: z.enum(['upsert', 'delete', 'begin', 'end']),
    data: z
      .record(z.string(), z.union([z.string().max(1000), z.number().finite(), z.null()]))
      .nullable(),
  })
  .strict();
export type SyncEvent = z.infer<typeof eventSchema>;
export function validPayload(event: SyncEvent) {
  if (event.kind === 'begin' || event.kind === 'end')
    return event.table === null && event.data === null;
  if (!event.table) return false;
  if (event.kind === 'delete') return event.data === null;
  const columns = analyticsColumns[event.table] as readonly string[];
  if (
    event.data?.id !== event.recordId ||
    Object.keys(event.data).length !== columns.length ||
    !columns.every((key) => Object.hasOwn(event.data!, key))
  )
    return false;
  if (!z.string().uuid().safeParse(event.recordId).success) return false;
  for (const field of ['created_at', 'date', 'expiry_date', 'received_date']) {
    const value = event.data[field];
    if (
      value !== undefined &&
      value !== null &&
      (typeof value !== 'string' || Number.isNaN(Date.parse(value)))
    )
      return false;
  }
  const numeric = new Set([
    'selling_price',
    'cost_price',
    'reorder_level',
    'active',
    'qty',
    'subtotal',
    'line_discount',
    'bill_discount',
    'loyalty_discount',
    'bag_total',
    'rounding',
    'total',
    'cost',
    'unit_price',
    'unit_cost',
    'discount',
    'line_total',
    'cost_total',
    'amount',
    'tendered',
    'credit_amount',
    'is_void',
    'damaged',
    'balance',
    'credit_limit',
    'points',
    'expiry_days',
    'dead_stock_days',
  ]);
  return Object.entries(event.data).every(([key, value]) =>
    numeric.has(key)
      ? typeof value === 'number' &&
        Number.isFinite(value) &&
        Math.abs(value) <= Number.MAX_SAFE_INTEGER
      : value === null || typeof value === 'string',
  );
}
export interface CloudStatus {
  connected: boolean;
  url: string;
  storeId: string;
  pending: number;
  quarantined: number;
  lastSync: string | null;
  error: string | null;
  needsRebuild: boolean;
  busy: boolean;
}
const stockQuantity = z
  .number()
  .min(0)
  .max(1000000)
  .refine(
    (v) => Math.abs(v * 1000 - Math.round(v * 1000)) < 0.00001,
    'Use at most three decimal places.',
  );
export const forecastSettingsSchema = z.object({
  leadDays: z.number().int().min(1).max(180).default(7),
  safetyStock: stockQuantity.default(0),
  minimumOrder: stockQuantity.default(1),
  orderMultiple: stockQuantity.refine((v) => v > 0).default(1),
  horizon: z.number().int().min(1).max(90).default(14),
});
export type ForecastSettings = z.infer<typeof forecastSettingsSchema>;

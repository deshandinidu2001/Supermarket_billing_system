import { z } from 'zod';
import type {
  Bootstrap,
  Cart,
  Dashboard,
  Product,
  Receipt,
  Report,
  Row,
  SaleResult,
  Settings,
  User,
} from './types';
const id = z.string().uuid();
const text = z.string().trim().max(500);
export const money = z.number().int().min(0).max(100_000_000_000);
export const qty = z
  .number()
  .positive()
  .max(1_000_000)
  .refine((v) => Math.abs(v * 1000 - Math.round(v * 1000)) < 0.00001, 'quantityPrecision');
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    'invalidDate',
  );
const pin = z.string().regex(/^\d{4,6}$/);
export const cartSchema = z.object({
  lines: z
    .array(z.object({ product_id: id, qty, discount_percent: z.number().min(0).max(100) }))
    .max(100),
  customer_id: id.nullable(),
  discount_type: z.enum(['percent', 'amount']),
  discount_value: z.number().min(0).max(1e10),
  bag_qty: z.number().int().min(0).max(1000),
  redeem_points: z.number().int().min(0).max(1e9),
});
export const productSchema = z.object({
  id: id.optional(),
  sku: text.min(1).max(60),
  barcodes: z.array(text.min(1).max(60)).min(1).max(10),
  name_en: text.min(1).max(150),
  name_si: text.min(1).max(150),
  category_id: id,
  unit: z.enum(['pcs', 'kg', 'g', 'l', 'ml', 'pack']),
  selling_price: money,
  mrp: money.nullable(),
  cost_price: money,
  reorder_level: z.number().min(0).max(1e6),
  active: z.boolean(),
  quick_access: z.boolean(),
  supplier_id: id.nullable(),
  image: z
    .string()
    .max(3e6)
    .nullable()
    .refine((v) => !v || /^data:image\/(png|jpeg|webp);base64,/.test(v)),
});
export const entitySchemas = {
  categories: z.object({ id: id.optional(), name_en: text.min(1), name_si: text.min(1) }),
  suppliers: z.object({
    id: id.optional(),
    name: text.min(1),
    phone: text,
    address: text,
    credit_days: z.number().int().min(0).max(365),
  }),
  customers: z.object({
    id: id.optional(),
    name: text.min(1),
    phone: text.min(5).max(30),
    address: text,
    credit_limit: money,
  }),
  expenses: z.object({
    id: id.optional(),
    date,
    amount: money.refine((v) => v > 0),
    note: text.min(1),
  }),
  cheques: z.object({
    id: id.optional(),
    supplier_id: id,
    number: text.min(1),
    bank: text.min(1),
    amount: money.refine((v) => v > 0),
    due_date: date,
    status: z.enum(['pending', 'cleared', 'returned']),
  }),
};
export type Entity = keyof typeof entitySchemas;
export const reportNames = [
  'sales',
  'products',
  'bottom',
  'profitProducts',
  'profitCategories',
  'cashiers',
  'lowStock',
  'expiring',
  'expired',
  'deadStock',
  'valuation',
  'credit',
  'supplierBalances',
  'returns',
  'discounts',
  'expenses',
  'audit',
  'cheques',
  'reorder',
] as const;
export type ReportName = (typeof reportNames)[number];
export const settingsSchema = z.object({
  shop_name: text.min(1).max(100),
  address: text,
  phone: text,
  footer_en: text,
  footer_si: text,
  logo: z
    .string()
    .max(3e6)
    .refine((v) => !v || /^data:image\/(png|jpeg|webp);base64,/.test(v)),
  counter_id: z.string().regex(/^[A-Z0-9]{1,8}$/),
  receipt_width: z.union([z.literal(58), z.literal(80)]),
  rounding: z.enum(['none', '1', '5']),
  loyalty_earn: z.number().min(0).max(100),
  loyalty_value: money,
  max_discount: z.number().min(0).max(100),
  idle_minutes: z.number().int().min(1).max(240),
  expiry_days: z.number().int().min(1).max(365),
  dead_stock_days: z.number().int().min(1).max(3650),
  allow_negative: z.boolean(),
  bag_price: money,
  backup_keep: z.number().int().min(1).max(365),
  scale_enabled: z.boolean(),
  scale_prefix: z.string().regex(/^\d{1,4}$/),
  scale_item_digits: z.number().int().min(1).max(8),
  scale_value_digits: z.number().int().min(1).max(8),
  scale_decimals: z.number().int().min(0).max(4),
  scale_mode: z.enum(['weight', 'price']),
});
const range = { from: date, to: date };
export const schemas = {
  login: z.object({ username: text.min(1), password: z.string().min(1).max(200) }),
  logout: z.object({}),
  activity: z.object({}),
  bootstrap: z.object({}),
  changePassword: z.object({
    current: z.string().max(200),
    password: z.string().min(8).max(200),
    pin: pin.optional(),
  }),
  language: z.object({ language: z.enum(['en', 'si']) }),
  products: z.object({
    query: text.default(''),
    limit: z.number().int().min(1).max(200).default(100),
    active: z.boolean().default(true),
  }),
  saveProduct: productSchema,
  adjustStock: z.object({
    product_id: id,
    batch_id: id.nullable(),
    qty: z
      .number()
      .min(-1e6)
      .max(1e6)
      .refine((v) => v !== 0 && Math.abs(v * 1000 - Math.round(v * 1000)) < 0.00001),
    reason: z.enum(['damage', 'expired', 'lost', 'correction']),
    cost_price: money,
    expiry_date: date.nullable(),
  }),
  batches: z.object({ product_id: id }),
  productDetails: z.object({ product_id: id }),
  list: z.object({
    entity: z.enum([
      'categories',
      'suppliers',
      'customers',
      'expenses',
      'cheques',
      'purchases',
      'users',
      'held_bills',
      'sales',
      'audit_logs',
      'shifts',
      'supplier_payments',
      'customer_payments',
    ]),
    query: text.default(''),
  }),
  saveEntity: z.object({
    entity: z.enum(['categories', 'suppliers', 'customers', 'expenses', 'cheques']),
    data: z.record(z.string(), z.unknown()),
  }),
  deleteEntity: z.object({
    entity: z.enum(['categories', 'suppliers', 'customers', 'expenses', 'cheques']),
    id,
  }),
  purchase: z.object({
    supplier_id: id,
    invoice_no: text.min(1),
    date,
    items: z
      .array(z.object({ product_id: id, qty, cost_price: money, expiry_date: date.nullable() }))
      .min(1)
      .max(100),
  }),
  supplierPayment: z.object({
    supplier_id: id,
    amount: money.refine((v) => v > 0),
    note: text,
    date,
  }),
  customerPayment: z.object({ customer_id: id, amount: money.refine((v) => v > 0), note: text }),
  customerHistory: z.object({ customer_id: id }),
  saveUser: z.object({
    id: id.optional(),
    username: z.string().regex(/^[a-zA-Z0-9_.-]{3,40}$/),
    display_name: text.min(1),
    password: z.string().min(8).max(200).optional(),
    active: z.boolean(),
  }),
  loadCart: z.object({}),
  cartProducts: z.object({}),
  saveCart: cartSchema,
  holdCart: z.object({ name: text.min(1) }),
  resumeCart: z.object({ id }),
  deleteHeld: z.object({ id }),
  checkout: z.object({
    payments: z
      .array(
        z.object({
          method: z.enum(['cash', 'card', 'qr', 'credit']),
          amount: money,
          reference: text,
          tendered: money,
        }),
      )
      .min(1)
      .max(10),
    request_id: id,
  }),
  receipt: z.object({ bill_no: text }),
  returnSale: z.object({
    sale_id: id,
    items: z
      .array(z.object({ sale_item_id: id, qty, damaged: z.boolean() }))
      .min(1)
      .max(100),
    reason: text.min(1),
    owner_pin: z.string().max(6).optional(),
    method: z.enum(['cash', 'card', 'qr', 'credit']),
    void: z.boolean().default(false),
  }),
  shift: z.object({ action: z.enum(['start', 'end', 'summary']) }),
  dashboard: z.object(range),
  report: z.object({ name: z.enum(reportNames), ...range }),
  settings: settingsSchema,
  backup: z.object({ choose_folder: z.boolean().default(false) }),
  restore: z.object({}),
  export: z.object({
    name: z.enum(reportNames),
    ...range,
    format: z.enum(['xlsx', 'csv', 'pdf']),
    print: z.boolean().default(false),
  }),
  productFile: z.object({ action: z.enum(['import', 'export', 'template']) }),
  printReceipt: z.object({ bill_no: text, pdf: z.boolean().default(false) }),
  printCustomerPayment: z.object({ id, pdf: z.boolean().default(false) }),
  integrity: z.object({}),
};
export type Action = keyof typeof schemas;
export type Input<K extends Action> = z.input<(typeof schemas)[K]>;
export interface Outputs {
  login: User;
  logout: boolean;
  activity: boolean;
  bootstrap: Bootstrap;
  changePassword: User;
  language: User;
  products: Product[];
  productDetails: Product & { barcodes: string[] };
  saveProduct: string;
  adjustStock: boolean;
  batches: Row[];
  list: Row[];
  saveEntity: string;
  deleteEntity: boolean;
  purchase: string;
  supplierPayment: string;
  customerPayment: string;
  customerHistory: { sales: Row[]; payments: Row[]; loyalty: Row[] };
  saveUser: string;
  loadCart: Cart;
  cartProducts: Product[];
  saveCart: Cart;
  holdCart: string;
  resumeCart: Cart;
  deleteHeld: boolean;
  checkout: SaleResult;
  receipt: Receipt;
  returnSale: string;
  shift: { shift: Row | null; methods: Row[]; bills: number; returns: number };
  dashboard: Dashboard;
  report: Report;
  settings: Settings;
  backup: string | null;
  restore: boolean;
  export: string | null;
  productFile: { count: number; path: string | null };
  printReceipt: string | null;
  printCustomerPayment: string | null;
  integrity: string;
}
export type Result<T> = { ok: true; data: T } | { ok: false; error: string; details?: string };
export interface Bridge {
  invoke<K extends Action>(action: K, input: Input<K>): Promise<Result<Outputs[K]>>;
}
declare global {
  interface Window {
    pos: Bridge;
  }
}

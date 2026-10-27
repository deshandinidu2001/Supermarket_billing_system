export type Role = 'owner' | 'cashier';
export type Lang = 'en' | 'si';
export type Row = Record<string, string | number | null>;
export interface User {
  id: string;
  username: string;
  display_name: string;
  role: Role;
  language: Lang;
  must_change_password: number;
}
export interface Product {
  id: string;
  sku: string;
  barcode: string;
  name_en: string;
  name_si: string;
  category_id: string;
  category_en: string;
  category_si: string;
  unit: string;
  selling_price: number;
  mrp: number | null;
  cost_price?: number;
  reorder_level: number;
  active: number;
  quick_access: number;
  supplier_id?: string | null;
  stock: number;
  image: string | null;
}
export interface CartLine {
  product_id: string;
  qty: number;
  discount_percent: number;
}
export interface Cart {
  lines: CartLine[];
  customer_id: string | null;
  discount_type: 'percent' | 'amount';
  discount_value: number;
  bag_qty: number;
  redeem_points: number;
}
export type PaymentMethod = 'cash' | 'card' | 'qr' | 'credit';
export interface Payment {
  method: PaymentMethod;
  amount: number;
  reference: string;
  tendered: number;
}
export interface Receipt {
  sale: Row;
  items: Row[];
  payments: Row[];
  customer: Row | null;
  shop: Settings;
}
export interface Report {
  title: string;
  columns: string[];
  rows: Row[];
  summary?: Record<string, number>;
}
export interface Dashboard {
  revenue: number;
  cogs: number;
  gross_profit: number;
  net_profit: number;
  expenses: number;
  bills: number;
  average: number;
  today: number;
  months: Row[];
  daily: Row[];
  methods: Row[];
  hours: Row[];
  comparison: Row[];
}
export interface Settings {
  shop_name: string;
  address: string;
  phone: string;
  footer_en: string;
  footer_si: string;
  logo: string;
  counter_id: string;
  receipt_width: number;
  rounding: 'none' | '1' | '5';
  loyalty_earn: number;
  loyalty_value: number;
  max_discount: number;
  idle_minutes: number;
  expiry_days: number;
  dead_stock_days: number;
  allow_negative: boolean;
  bag_price: number;
  backup_folder: string;
  backup_keep: number;
  last_backup: string;
  scale_enabled: boolean;
  scale_prefix: string;
  scale_item_digits: number;
  scale_value_digits: number;
  scale_decimals: number;
  scale_mode: 'weight' | 'price';
}
export interface Bootstrap {
  user: User;
  settings: Settings;
  categories: Row[];
  alerts: {
    low: number;
    expiring: number;
    expired: number;
    cheques: number;
    backup_overdue: boolean;
  };
  shift: Row | null;
}
export interface SaleResult {
  id: string;
  bill_no: string;
  total: number;
  change: number;
}
export const emptyCart = (): Cart => ({
  lines: [],
  customer_id: null,
  discount_type: 'percent',
  discount_value: 0,
  bag_qty: 0,
  redeem_points: 0,
});

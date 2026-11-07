import type { Analytics, forecasts } from './engine';
import type { ForecastSettings } from '../../shared/analytics';
export interface OwnerStore {
  id: string;
  name: string;
  timezone: string;
  last_synced: string | null;
}
export interface OwnerData {
  store: OwnerStore;
  report: Analytics;
  forecasts: ReturnType<typeof forecasts>;
  forecastSettings: ForecastSettings;
}
export type Answer = {
  answer: {
    interpretation: string;
    from: string | null;
    to: string | null;
    rows: Record<string, unknown>[];
  };
  lastSynced: string | null;
};
export class SessionExpired extends Error {}
export async function request<T>(
  base: string,
  path: string,
  body?: unknown,
  token?: string,
): Promise<T> {
  const response = await fetch(`${base}/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: token ? 'omit' : 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const data = await response.json();
  if (response.status === 401 || response.status === 403)
    throw new SessionExpired(data.error || 'Sign in again.');
  if (!response.ok) throw new Error(data.error || 'Request failed. Try again.');
  return data as T;
}
export function freshness(lastSync: string | null, now = Date.now()) {
  if (!lastSync) return { stale: true, text: 'Waiting for the first store upload' };
  return {
    stale: now - Date.parse(lastSync) > 15 * 60000,
    text: `Last synced ${new Date(lastSync).toLocaleString()}`,
  };
}
export function csv(rows: Record<string, unknown>[]) {
  const keys = [...new Set(rows.flatMap(Object.keys))];
  const cell = (value: unknown) => {
    let text = String(value ?? '');
    if (typeof value === 'string' && /^[=+@\-\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  return (
    '\uFEFF' +
    [keys.map(cell).join(','), ...rows.map((r) => keys.map((k) => cell(r[k])).join(','))].join(
      '\r\n',
    )
  );
}
export const money = (cents: number) =>
  `Rs. ${(cents / 100).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const moneyKeys = new Set([
  'total',
  'amount',
  'cost',
  'cost_total',
  'line_total',
  'unit_price',
  'unit_cost',
  'tendered',
  'discount',
  'revenue',
  'refunds',
  'cogs',
  'grossProfit',
  'netProfit',
  'expenses',
  'average',
  'customerCredit',
  'supplierBalance',
  'profit',
]);
export function displayValue(key: string, value: unknown) {
  return typeof value === 'number' && moneyKeys.has(key)
    ? money(value)
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value ?? '—');
}

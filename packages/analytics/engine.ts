import type { AnalyticsRow, Dataset, ForecastSettings } from '../../shared/analytics';

export function localDay(value: string, timezone = 'Asia/Colombo') {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}
export function addDays(day: string, days: number) {
  return new Date(Date.parse(`${day}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}
export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
}
export function groupTrend(
  rows: { date: string; revenue: number; profit: number }[],
  period: 'day' | 'week' | 'month',
) {
  const groups = new Map<string, { date: string; revenue: number; profit: number }>();
  for (const row of rows) {
    const weekday = (new Date(`${row.date}T12:00:00Z`).getUTCDay() + 6) % 7;
    const date =
      period === 'month'
        ? `${row.date.slice(0, 7)}-01`
        : period === 'week'
          ? addDays(row.date, -weekday)
          : row.date;
    const group = groups.get(date) ?? { date, revenue: 0, profit: 0 };
    group.revenue += row.revenue;
    group.profit += row.profit;
    groups.set(date, group);
  }
  return [...groups.values()];
}
export const num = (r: AnalyticsRow, key: string) => Number(r[key] ?? 0);
function groupRows(rows: AnalyticsRow[], key: (row: AnalyticsRow) => string | number | null) {
  const groups = new Map<string, AnalyticsRow[]>();
  for (const row of rows) {
    const id = String(key(row)),
      values = groups.get(id) ?? [];
    values.push(row);
    groups.set(id, values);
  }
  return groups;
}
export function canonical(row: AnalyticsRow) {
  return JSON.stringify(
    Object.fromEntries(
      Object.keys(row)
        .sort()
        .map((k) => [k, row[k]]),
    ),
  );
}
export const defaultForecast: ForecastSettings = {
  leadDays: 7,
  safetyStock: 0,
  minimumOrder: 1,
  orderMultiple: 1,
  horizon: 14,
};

export function analytics(
  data: Dataset,
  from: string,
  to: string,
  timezone = 'Asia/Colombo',
  clock = new Date(),
) {
  const rows = (table: keyof Dataset) => data[table] ?? [];
  const day = (r: AnalyticsRow) => localDay(String(r.created_at), timezone);
  const range = (r: AnalyticsRow) => day(r) >= from && day(r) <= to;
  const sales = rows('sales').filter(range),
    returns = rows('returns').filter(range);
  const sum = (rs: AnalyticsRow[], field: string) => rs.reduce((s, r) => s + num(r, field), 0);
  const revenue = sum(sales, 'total') - sum(returns, 'total');
  const cogs = sum(sales, 'cost') - sum(returns, 'cost');
  const expenses = sum(
    rows('expenses').filter((r) => String(r.date) >= from && String(r.date) <= to),
    'amount',
  );
  const daily = Array.from({ length: daysBetween(from, to) + 1 }, (_, i) => ({
    date: addDays(from, i),
    revenue: 0,
    profit: 0,
  }));
  const byDay = new Map(daily.map((r) => [r.date, r]));
  for (const [rs, sign] of [
    [sales, 1],
    [returns, -1],
  ] as const)
    for (const r of rs) {
      const d = byDay.get(day(r))!;
      d.revenue += sign * num(r, 'total');
      d.profit += sign * (num(r, 'total') - num(r, 'cost'));
    }
  for (const e of rows('expenses')) {
    const d = byDay.get(String(e.date));
    if (d) d.profit -= num(e, 'amount');
  }
  const current = localDay(clock.toISOString(), timezone);
  const items = rows('sale_items'),
    returnItems = rows('return_items');
  const itemById = new Map(items.map((r) => [r.id, r]));
  const saleIds = new Set(sales.map((s) => s.id)),
    returnIds = new Set(returns.map((r) => r.id));
  const soldGroups = groupRows(
    items.filter((i) => saleIds.has(i.sale_id)),
    (i) => i.product_id,
  );
  const returnGroups = groupRows(
    returnItems.filter((i) => returnIds.has(i.return_id)),
    (i) => itemById.get(i.sale_item_id)?.product_id ?? null,
  );
  const batchGroups = groupRows(rows('batches'), (b) => b.product_id);
  const products = rows('products').map((p) => {
    const sold = soldGroups.get(String(p.id)) ?? [],
      refunded = returnGroups.get(String(p.id)) ?? [],
      batches = batchGroups.get(String(p.id)) ?? [];
    const available = batches
      .filter((b) => !b.expiry_date || String(b.expiry_date) >= current)
      .reduce((s, b) => s + Math.max(0, num(b, 'qty')), 0);
    const expired = batches
      .filter((b) => b.expiry_date && String(b.expiry_date) < current)
      .reduce((s, b) => s + Math.max(0, num(b, 'qty')), 0);
    const nearExpiry = batches.filter(
      (b) =>
        num(b, 'qty') > 0 &&
        b.expiry_date &&
        String(b.expiry_date) >= current &&
        String(b.expiry_date) <= addDays(current, 7),
    );
    const productRevenue = sum(sold, 'line_total') - sum(refunded, 'amount');
    return {
      id: String(p.id),
      name: String(p.name_en),
      nameSi: String(p.name_si),
      sku: String(p.sku),
      unit: String(p.unit),
      active: !!p.active,
      quantity: sum(sold, 'qty') - sum(refunded, 'qty'),
      revenue: productRevenue,
      profit: productRevenue - sum(sold, 'cost_total') + sum(refunded, 'cost'),
      stock: batches.reduce((s, b) => s + num(b, 'qty'), 0),
      available,
      expired,
      reorderLevel: num(p, 'reorder_level'),
      nearExpiry,
    };
  });
  const suppliers = rows('suppliers').map((s) => ({
    id: String(s.id),
    name: String(s.name),
    balance:
      sum(
        rows('purchases').filter((p) => p.supplier_id === s.id),
        'total',
      ) -
      sum(
        rows('supplier_payments').filter((p) => p.supplier_id === s.id),
        'amount',
      ) -
      sum(
        rows('supplier_returns').filter((p) => p.supplier_id === s.id),
        'total',
      ),
  }));
  const categories = rows('categories').map((c) => ({
    id: c.id,
    name: c.name_en,
    ...rows('products')
      .filter((p) => p.category_id === c.id)
      .reduce<{ revenue: number; profit: number }>(
        (a, p) => {
          const m = products.find((m) => m.id === p.id)!;
          return { revenue: a.revenue + m.revenue, profit: a.profit + m.profit };
        },
        { revenue: 0, profit: 0 },
      ),
  }));
  return {
    from,
    to,
    summary: {
      revenue,
      refunds: sum(returns, 'total'),
      cogs,
      grossProfit: revenue - cogs,
      expenses,
      netProfit: revenue - cogs - expenses,
      bills: sales.length,
      average: sales.length ? Math.round(revenue / sales.length) : 0,
      customerCredit: sum(rows('customers'), 'balance'),
      supplierBalance: suppliers.reduce((s, r) => s + r.balance, 0),
    },
    daily,
    products,
    categories,
    suppliers,
    sales: sales
      .map(
        (s) =>
          ({
            ...s,
            refunds: sum(
              rows('returns').filter((r) => r.sale_id === s.id),
              'total',
            ),
          }) as AnalyticsRow & { refunds: number },
      )
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))),
  };
}
export type Analytics = ReturnType<typeof analytics>;

export function forecastSeries(series: number[], horizon: number) {
  const moving = (history: number[]) =>
    Array(horizon).fill(
      history.slice(-28).reduce((a, b) => a + b, 0) / Math.min(28, history.length),
    );
  const seasonal = (history: number[]) =>
    Array.from({ length: horizon }, (_, i) => history[history.length - 7 + (i % 7)]);
  if (series.length < 14 || series.every((v) => v === 0))
    return { method: 'insufficient' as const, values: [] as number[], mae: null, backtestDays: 0 };
  const errors = { moving: [] as number[], seasonal: [] as number[] };
  for (let i = Math.max(14, series.length - 28); i < series.length; i++) {
    const history = series.slice(0, i);
    errors.moving.push(Math.abs(moving(history)[0] - series[i]));
    errors.seasonal.push(Math.abs(seasonal(history)[0] - series[i]));
  }
  const mae = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
  const method =
    errors.moving.length && mae(errors.seasonal) < mae(errors.moving) ? 'seasonal' : 'moving';
  return {
    method,
    values: (method === 'moving' ? moving : seasonal)(series),
    mae: errors.moving.length ? mae(errors[method]) : null,
    backtestDays: errors.moving.length,
  };
}
export function forecasts(
  data: Dataset,
  settings: ForecastSettings = defaultForecast,
  timezone = 'Asia/Colombo',
  clock = new Date(),
) {
  const itemGroups = groupRows(data.sale_items ?? [], (r) => r.product_id),
    movementGroups = groupRows(data.stock_movements ?? [], (r) => r.product_id),
    batchGroups = groupRows(data.batches ?? [], (r) => r.product_id);
  const today = localDay(clock.toISOString(), timezone),
    end = addDays(today, -1);
  return (data.products ?? [])
    .filter((p) => p.active)
    .map((p) => {
      const productItems = itemGroups.get(String(p.id)) ?? [];
      const movements = movementGroups.get(String(p.id)) ?? [];
      const dates = [...productItems, ...movements]
        .map((r) => localDay(String(r.created_at), timezone))
        .filter((d) => d <= end)
        .sort();
      const start = dates[0] && dates[0] > addDays(end, -179) ? dates[0] : addDays(end, -179);
      const series = Array.from({ length: Math.max(0, daysBetween(start, end) + 1) }, () => 0);
      for (const item of productItems) {
        const index = daysBetween(start, localDay(String(item.created_at), timezone));
        if (index >= 0 && index < series.length) series[index] += num(item, 'qty');
      }
      // Forecast gross units sold: returns are shown in financial reports, not subtracted
      // from observed purchase demand. Missing days inside observed coverage are zeros.
      const f = forecastSeries(series, Math.max(settings.horizon, settings.leadDays));
      const daily = f.values.length ? f.values.reduce((a, b) => a + b, 0) / f.values.length : 0;
      const batches = (batchGroups.get(String(p.id)) ?? []).filter(
        (b) => num(b, 'qty') > 0 && (!b.expiry_date || String(b.expiry_date) >= today),
      );
      const available = batches.reduce((s, b) => s + num(b, 'qty'), 0);
      // Conservative: exclude quantities expiring before replenishment arrives.
      const expiringBeforeDelivery = batches
        .filter((b) => b.expiry_date && String(b.expiry_date) < addDays(today, settings.leadDays))
        .reduce((s, b) => s + num(b, 'qty'), 0);
      const usable = Math.max(0, available - expiringBeforeDelivery);
      const target =
        f.values.slice(0, settings.leadDays).reduce((a, b) => a + b, 0) + settings.safetyStock;
      const shortage = Math.max(0, target - usable);
      const orderMultiple = ['pcs', 'pack'].includes(String(p.unit))
        ? Math.max(1, Math.ceil(settings.orderMultiple))
        : settings.orderMultiple;
      const suggested =
        f.method === 'insufficient'
          ? null
          : shortage > 0
            ? Math.round(
                Math.ceil(Math.max(shortage, settings.minimumOrder) / orderMultiple) *
                  orderMultiple *
                  1000,
              ) / 1000
            : 0;
      const likelyStockout =
        available <= 0 || (movements.some((m) => num(m, 'qty') < 0) && series.some((v) => v === 0));
      return {
        productId: String(p.id),
        name: String(p.name_en),
        nameSi: String(p.name_si),
        unit: String(p.unit),
        method: f.method,
        historyDays: dates.length ? series.length : 0,
        mae: f.mae,
        backtestDays: f.backtestDays,
        dailyDemand: daily,
        horizon: settings.horizon,
        predicted: f.values.slice(0, settings.horizon).reduce((a, b) => a + b, 0),
        available,
        expiringBeforeDelivery,
        suggested,
        warning:
          f.method === 'insufficient'
            ? 'Insufficient sales history'
            : likelyStockout
              ? 'Observed sales may understate demand during stockouts'
              : null,
        explanation: `${settings.leadDays} days of forecast demand + ${settings.safetyStock} safety stock; ${usable.toFixed(3)} ${p.unit} usable after excluding ${expiringBeforeDelivery.toFixed(3)} expiring before delivery. Order multiple ${orderMultiple}, minimum ${settings.minimumOrder}.`,
      };
    });
}

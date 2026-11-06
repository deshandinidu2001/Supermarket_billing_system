import type { Dashboard, Row } from '../shared/types';

const dateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export interface MockSale {
  bill_no: string;
  date: string;
  hour: number;
  method: 'cash' | 'card' | 'qr';
  total: number;
  cost: number;
}

// Preview records are deterministic and never written to the store's sales or stock tables.
export function mockRecords(asOf = new Date()) {
  const start = new Date(asOf.getFullYear(), asOf.getMonth() - 11, 1, 12);
  const end = dateKey(asOf);
  const sales: MockSale[] = [];
  const expenses: { date: string; amount: number }[] = [];
  for (const day = new Date(start); dateKey(day) <= end; day.setDate(day.getDate() + 1)) {
    const date = dateKey(day);
    let state = Number(date.replaceAll('-', ''));
    const random = () => {
      state = (state * 16807) % 2147483647;
      return state / 2147483647;
    };
    const count = 12 + Math.floor(random() * 15) + (day.getDay() === 6 ? 8 : 0);
    const growth =
      1 +
      ((day.getFullYear() - start.getFullYear()) * 12 + day.getMonth() - start.getMonth()) * 0.025;
    for (let index = 0; index < count; index++) {
      const total = Math.round((350 + random() * 5200) * growth) * 100;
      const method = random();
      sales.push({
        bill_no: `MOCK-${date.replaceAll('-', '')}-${String(index + 1).padStart(3, '0')}`,
        date,
        hour: 8 + Math.floor(random() * 12),
        method: method < 0.66 ? 'cash' : method < 0.9 ? 'card' : 'qr',
        total,
        cost: Math.round(total * (0.7 + random() * 0.12)),
      });
    }
    expenses.push({ date, amount: (1200 + Math.floor(random() * 1800)) * 100 });
  }
  return { sales, expenses };
}

export function mockOverview(from: string, to: string, asOf = new Date()): Dashboard {
  const records = mockRecords(asOf);
  const sales = records.sales.filter((sale) => sale.date >= from && sale.date <= to);
  const expenses = records.expenses
    .filter((entry) => entry.date >= from && entry.date <= to)
    .reduce((sum, entry) => sum + entry.amount, 0);
  const revenue = sales.reduce((sum, sale) => sum + sale.total, 0);
  const cogs = sales.reduce((sum, sale) => sum + sale.cost, 0);
  const months: Row[] = Array.from({ length: 12 }, (_, index) => {
    const end = new Date(`${to}T12:00:00`);
    const month = dateKey(new Date(end.getFullYear(), end.getMonth() - 11 + index, 1, 12)).slice(
      0,
      7,
    );
    const entries = records.sales.filter((sale) => sale.date.startsWith(month));
    const revenue = entries.reduce((sum, sale) => sum + sale.total, 0);
    const costs = entries.reduce((sum, sale) => sum + sale.cost, 0);
    const expenses = records.expenses
      .filter((entry) => entry.date.startsWith(month))
      .reduce((sum, entry) => sum + entry.amount, 0);
    return { month, revenue, profit: revenue - costs - expenses };
  });
  const dates = [...new Set(sales.map((sale) => sale.date))];
  return {
    revenue,
    cogs,
    gross_profit: revenue - cogs,
    net_profit: revenue - cogs - expenses,
    expenses,
    bills: sales.length,
    average: sales.length ? Math.round(revenue / sales.length) : 0,
    today: records.sales
      .filter((sale) => sale.date === dateKey(asOf))
      .reduce((sum, sale) => sum + sale.total, 0),
    months,
    daily: dates.map((date) => {
      const entries = sales.filter((sale) => sale.date === date);
      return {
        date,
        revenue: entries.reduce((sum, sale) => sum + sale.total, 0),
        profit: entries.reduce((sum, sale) => sum + sale.total - sale.cost, 0),
      };
    }),
    methods: ['cash', 'card', 'qr'].map((method) => ({
      method,
      amount: sales
        .filter((sale) => sale.method === method)
        .reduce((sum, sale) => sum + sale.total, 0),
    })),
    hours: Array.from({ length: 12 }, (_, index) => {
      const hour = index + 8;
      const entries = sales.filter((sale) => sale.hour === hour);
      return {
        hour: String(hour).padStart(2, '0'),
        bills: entries.length,
        revenue: entries.reduce((sum, sale) => sum + sale.total, 0),
      };
    }),
    comparison: months.slice(-2),
  };
}

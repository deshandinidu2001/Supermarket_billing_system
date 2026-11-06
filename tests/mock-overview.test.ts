import { describe, expect, it } from 'vitest';
import { mockOverview, mockRecords } from '../services/mock-overview';

const today = new Date(2026, 10, 6, 12);
describe('mock Overview records', () => {
  it('covers twelve months with deterministic, clearly marked records and no future dates', () => {
    const records = mockRecords(today);
    expect(records).toEqual(mockRecords(today));
    expect(new Set(records.sales.map((sale) => sale.date.slice(0, 7))).size).toBe(12);
    expect(
      records.sales.every((sale) => sale.bill_no.startsWith('MOCK-') && sale.date <= '2026-11-06'),
    ).toBe(true);
  });
  it('keeps date filters, payment totals, daily totals and profits consistent', () => {
    const result = mockOverview('2026-11-01', '2026-11-06', today);
    expect(result.months).toHaveLength(12);
    expect(
      result.months.every((month) => Number(month.revenue) > 0 && Number(month.profit) > 0),
    ).toBe(true);
    expect(result.daily).toHaveLength(6);
    expect(result.daily.reduce((sum, day) => sum + Number(day.revenue), 0)).toBe(result.revenue);
    expect(result.methods.reduce((sum, method) => sum + Number(method.amount), 0)).toBe(
      result.revenue,
    );
    expect(result.hours.reduce((sum, hour) => sum + Number(hour.bills), 0)).toBe(result.bills);
    expect(result.net_profit).toBe(result.revenue - result.cogs - result.expenses);
    const empty = mockOverview('2020-01-01', '2020-01-31', today);
    expect(empty.revenue).toBe(0);
    expect(empty.bills).toBe(0);
  });
});

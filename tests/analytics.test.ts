import { describe, it, expect } from 'vitest';
import {
  analytics,
  forecasts,
  forecastSeries,
  localDay,
  groupTrend,
} from '../packages/analytics/engine';
import { csv, displayValue, freshness } from '../packages/analytics/client';
import { labels } from '../packages/analytics/locales';
import { ownerCache } from '../packages/analytics/secure-cache';
describe('owner analytics', () => {
  it('formats measured stock without floating-point artifacts and keeps money in cents', () => {
    expect(displayValue('quantity', 26.031999999999996)).toBe('26.032');
    expect(displayValue('revenue', 12345)).toBe('Rs. 123.45');
  });
  it('aggregates daily trends without losing values across calendar boundaries', () => {
    const rows = [
      { date: '2026-12-31', revenue: 100, profit: 30 },
      { date: '2027-01-01', revenue: 200, profit: 50 },
    ];
    expect(groupTrend(rows, 'week')).toEqual([{ date: '2026-12-28', revenue: 300, profit: 80 }]);
    expect(groupTrend(rows, 'month').map((v) => v.revenue)).toEqual([100, 200]);
  });
  it('keeps refunds on return date and ignores expired stock', () => {
    const data = {
      products: [
        {
          id: 'p',
          name_en: 'Rice',
          name_si: 'සහල්',
          sku: 'R',
          unit: 'kg',
          active: 1,
          reorder_level: 5,
        },
      ],
      sales: [{ id: 's', created_at: '2026-11-01T09:00:00Z', total: 1000, cost: 600 }],
      returns: [{ id: 'r', sale_id: 's', created_at: '2026-11-07T09:00:00Z', total: 200, cost: 0 }],
      expenses: [{ id: 'e', date: '2026-11-07', amount: 50 }],
      batches: [
        { id: 'b', product_id: 'p', qty: 20, expiry_date: '2026-11-06' },
        { id: 'c', product_id: 'p', qty: 3, expiry_date: '2026-11-07' },
      ],
    };
    const r = analytics(
      data,
      '2026-11-07',
      '2026-11-07',
      'Asia/Colombo',
      new Date('2026-11-07T12:00:00Z'),
    );
    expect(r.summary.revenue).toBe(-200);
    expect(r.summary.netProfit).toBe(-250);
    expect(r.products[0].available).toBe(3);
    expect(r.products[0].expired).toBe(20);
  });
  it('handles insufficient history and protects CSV exports', () => {
    expect(forecastSeries([1], 7).method).toBe('insufficient');
    expect(forecasts({}, undefined)).toEqual([]);
    expect(csv([{ name: '=HYPERLINK("x")' }])).toContain("'=HYPERLINK");
  });
  it('labels stale data, handles local dates and includes both languages', () => {
    expect(freshness(null).stale).toBe(true);
    expect(localDay('2026-11-07T20:00:00Z')).toBe('2026-11-08');
    expect(Object.keys(labels.en).sort()).toEqual(Object.keys(labels.si).sort());
  });
  it('isolates cached accounts and stores, clears on logout, and rejects interrupted writes', async () => {
    const records = new Map<string, string>();
    let interrupted = false;
    const cache = ownerCache({
      get: async (k) => records.get(k) ?? null,
      set: async (k, v) => {
        if (interrupted && k.endsWith('_1')) throw new Error('simulated interrupted write');
        records.set(k, v);
      },
      remove: async (k) => {
        records.delete(k);
      },
    });
    const payload = {
      store: { id: 'one', name: 'Test', timezone: 'Asia/Colombo', last_synced: null },
      report: analytics({}, '2026-11-01', '2026-11-30'),
      forecasts: [],
      forecastSettings: {
        leadDays: 7,
        safetyStock: 0,
        minimumOrder: 1,
        orderMultiple: 1,
        horizon: 14,
      },
    };
    await cache.write('owner-a', 'store-a', payload);
    expect((await cache.read('owner-a', 'store-a'))?.data.store.name).toBe('Test');
    expect(await cache.read('owner-b', 'store-a')).toBe(null);
    expect(await cache.read('owner-a', 'store-b')).toBe(null);
    interrupted = true;
    await expect(cache.write('owner-a', 'store-a', payload)).rejects.toThrow();
    expect(await cache.read('owner-a', 'store-a')).toBe(null);
    interrupted = false;
    await cache.clear();
    expect(records.size).toBe(0);
  });
});

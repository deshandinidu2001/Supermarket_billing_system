import type { OwnerData } from './client';
export interface SecureKeyStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
export function ownerCache(storage: SecureKeyStore) {
  const indexKey = 'ajith_cache_keys';
  return {
    async write(owner: string, store: string, data: OwnerData) {
      const base = `ajith_cache_${owner}_${store}`;
      const safe = {
        ...data,
        report: {
          ...data.report,
          daily: data.report.daily.slice(-31),
          products: data.report.products.slice(0, 30),
          sales: data.report.sales.slice(0, 20),
          suppliers: [],
        },
        forecasts: data.forecasts.slice(0, 20),
      };
      const value = JSON.stringify({ savedAt: new Date().toISOString(), data: safe }),
        chunks = value.match(/[\s\S]{1,500}/g) ?? [];
      if (chunks.length > 160) return;
      const keys = JSON.parse((await storage.get(indexKey)) ?? '[]') as string[];
      if (!keys.includes(base)) await storage.set(indexKey, JSON.stringify([...keys, base]));
      await storage.remove(base);
      for (let i = 0; i < chunks.length; i++) await storage.set(`${base}_${i}`, chunks[i]);
      await storage.set(base, JSON.stringify({ chunks: chunks.length }));
    },
    async read(owner: string, store: string): Promise<{ savedAt: string; data: OwnerData } | null> {
      const base = `ajith_cache_${owner}_${store}`,
        raw = await storage.get(base);
      if (!raw) return null;
      try {
        const { chunks } = JSON.parse(raw);
        if (!Number.isInteger(chunks) || chunks < 1 || chunks > 160) return null;
        const values = await Promise.all(
          Array.from({ length: chunks }, (_, i) => storage.get(`${base}_${i}`)),
        );
        if (values.some((v) => v === null)) return null;
        return JSON.parse(values.join(''));
      } catch {
        return null;
      }
    },
    async clear() {
      const keys = JSON.parse((await storage.get(indexKey)) ?? '[]') as string[];
      for (const base of keys) {
        for (let i = 0; i < 160; i++) await storage.remove(`${base}_${i}`);
        await storage.remove(base);
      }
      await storage.remove(indexKey);
    },
  };
}

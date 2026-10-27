import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { migrations } from './migrations';
import type { Row, Settings } from '../shared/types';
export const now = () => new Date().toISOString();
export const today = () => localDate(new Date());
export function localDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const uid = () => randomUUID();
export const defaults: Settings = {
  shop_name: 'Ajith Super Market',
  address: '',
  phone: '',
  footer_en: 'Thank you. See you again!',
  footer_si: 'ස්තුතියි. නැවත හමුවෙමු!',
  logo: '',
  counter_id: 'C1',
  receipt_width: 80,
  rounding: 'none',
  loyalty_earn: 1,
  loyalty_value: 100,
  max_discount: 5,
  idle_minutes: 15,
  expiry_days: 30,
  dead_stock_days: 60,
  allow_negative: false,
  bag_price: 1000,
  backup_folder: '',
  backup_keep: 14,
  last_backup: '',
  scale_enabled: false,
  scale_prefix: '22',
  scale_item_digits: 5,
  scale_value_digits: 5,
  scale_decimals: 3,
  scale_mode: 'weight',
};
export class Store {
  db: Database.Database;
  constructor(public path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('synchronous = FULL');
    this.db.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)',
    );
    for (const migration of migrations)
      if (!this.get('SELECT version FROM schema_migrations WHERE version=?', migration.version))
        this.db.transaction(() => {
          this.db.exec(migration.sql);
          this.run('INSERT INTO schema_migrations VALUES (?,?)', migration.version, now());
        })();
    if (!this.get('SELECT id FROM settings WHERE setting_key=?', 'app'))
      this.insert('settings', { setting_key: 'app', value: JSON.stringify(defaults) });
  }
  all<T = Row>(sql: string, ...params: (string | number | null)[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }
  get<T = Row>(sql: string, ...params: (string | number | null)[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }
  run(sql: string, ...params: (string | number | null)[]) {
    return this.db.prepare(sql).run(...params);
  }
  insert(table: string, data: Record<string, string | number | null>): string {
    const record = { id: uid(), created_at: now(), updated_at: now(), ...data };
    const keys = Object.keys(record);
    this.run(
      `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`,
      ...Object.values(record),
    );
    return record.id;
  }
  update(table: string, id: string, data: Record<string, string | number | null>) {
    const record = { ...data, updated_at: now() };
    this.run(
      `UPDATE ${table} SET ${Object.keys(record)
        .map((k) => `${k}=?`)
        .join(',')} WHERE id=?`,
      ...Object.values(record),
      id,
    );
  }
  settings(): Settings {
    return {
      ...defaults,
      ...JSON.parse(
        String(this.get('SELECT value FROM settings WHERE setting_key=?', 'app')!.value),
      ),
    };
  }
  saveSettings(settings: Settings) {
    const row = this.get('SELECT id FROM settings WHERE setting_key=?', 'app')!;
    this.update('settings', String(row.id), { value: JSON.stringify(settings) });
  }
  audit(user: string | null, action: string, entity: string | null = null, details: unknown = {}) {
    this.insert('audit_logs', {
      user_id: user,
      action,
      entity_id: entity,
      details: JSON.stringify(details),
    });
  }
  integrity() {
    return String(this.get('PRAGMA integrity_check')?.integrity_check ?? 'failed');
  }
  close() {
    this.db.pragma('wal_checkpoint(TRUNCATE)');
    this.db.close();
  }
}

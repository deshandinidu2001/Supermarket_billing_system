import Database from 'better-sqlite3';
import { dialog } from 'electron';
import { mkdirSync, readdirSync, renameSync, unlinkSync, copyFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { Store, now } from '../db/database';
import { migrations } from '../db/migrations';
import type { Auth } from '../services/auth';
import { AppError } from '../services/errors';
import { label } from './files';
export class Backups {
  private busy = false;
  constructor(
    public store: Store,
    public auth: Auth,
  ) {}
  async backup(chooseFolder = false, automatic = false) {
    const user = automatic ? null : this.auth.owner();
    const s = this.store.settings();
    if (chooseFolder) {
      const result = await dialog.showOpenDialog({
        title: label('chooseBackup', user?.language),
        properties: ['openDirectory', 'createDirectory'],
      });
      if (result.canceled) return null;
      s.backup_folder = result.filePaths[0];
      this.store.saveSettings(s);
    }
    if (!s.backup_folder) {
      if (automatic) return null;
      throw new AppError('backupFolderRequired');
    }
    if (this.busy) return null;
    this.busy = true;
    try {
      mkdirSync(s.backup_folder, { recursive: true });
      const path = join(s.backup_folder, `ajith-backup-${now().replace(/[:.]/g, '-')}.db`);
      await this.store.db.backup(`${path}.partial`);
      renameSync(`${path}.partial`, path);
      verifyBackup(path);
      s.last_backup = now();
      this.store.saveSettings(s);
      this.store.audit(user?.id ?? null, 'backup', null, { path, automatic });
      const files = readdirSync(s.backup_folder)
        .filter((f) => /^ajith-backup-\d{4}-.*\.db$/.test(f))
        .sort()
        .reverse();
      for (const file of files.slice(s.backup_keep)) unlinkSync(join(s.backup_folder, file));
      return path;
    } finally {
      this.busy = false;
    }
  }
  async restore() {
    const user = this.auth.owner();
    const pick = await dialog.showOpenDialog({
      title: label('restore', user.language),
      properties: ['openFile'],
      filters: [{ name: 'SQLite backup', extensions: ['db'] }],
    });
    if (pick.canceled) return false;
    const source = pick.filePaths[0];
    verifyBackup(source);
    if (resolve(source) === resolve(this.store.path)) throw new AppError('invalidBackup');
    const confirm = await dialog.showMessageBox({
      type: 'warning',
      title: label('restore', user.language),
      message: label('restoreConfirm', user.language),
      buttons: [label('cancel', user.language), label('restore', user.language)],
      defaultId: 0,
      cancelId: 0,
    });
    if (confirm.response !== 1) return false;
    const safety = join(dirname(this.store.path), `safety-before-restore-${Date.now()}.db`);
    await this.store.db.backup(safety);
    this.store.close();
    const incoming = `${this.store.path}.incoming`;
    copyFileSync(source, incoming);
    for (const suffix of ['-wal', '-shm'])
      if (existsSync(`${this.store.path}${suffix}`)) unlinkSync(`${this.store.path}${suffix}`);
    renameSync(incoming, this.store.path);
    return true;
  }
  async daily() {
    const s = this.store.settings();
    if (
      s.backup_folder &&
      (!s.last_backup || new Date(s.last_backup).toDateString() !== new Date().toDateString())
    )
      await this.backup(false, true);
  }
}
export function verifyBackup(path: string) {
  let db: Database.Database | undefined;
  try {
    db = new Database(path, { readonly: true, fileMustExist: true });
    const result = db.pragma('integrity_check', { simple: true });
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
      name: string;
    }[];
    const version = db.prepare('SELECT MAX(version) v FROM schema_migrations').get() as {
      v: number;
    };
    const required = [
      'users',
      'categories',
      'products',
      'product_barcodes',
      'batches',
      'stock_movements',
      'suppliers',
      'purchases',
      'purchase_items',
      'supplier_payments',
      'cheques',
      'customers',
      'loyalty_transactions',
      'customer_payments',
      'sales',
      'sale_items',
      'payments',
      'held_bills',
      'returns',
      'return_items',
      'shifts',
      'expenses',
      'audit_logs',
      'settings',
      'counters',
    ];
    if (
      result !== 'ok' ||
      !migrations.some((m) => m.version === version.v) ||
      !required.every((t) => tables.some((v) => v.name === t))
    )
      throw new Error('invalid');
    const foreign = db.pragma('foreign_key_check') as unknown[];
    if (foreign.length) throw new Error('foreign');
    const settings = db
      .prepare(`SELECT value FROM settings WHERE ${version.v >= 3 ? 'setting_key' : 'id'}='app'`)
      .get() as { value: string } | undefined;
    if (!settings || typeof JSON.parse(settings.value).shop_name !== 'string')
      throw new Error('settings');
  } catch {
    throw new AppError('invalidBackup');
  } finally {
    db?.close();
  }
}

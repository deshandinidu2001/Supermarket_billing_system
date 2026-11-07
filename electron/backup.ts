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
  status() {
    this.auth.owner();
    return this.store.get('SELECT * FROM backup_verifications ORDER BY rowid DESC LIMIT 1') ?? null;
  }
  private verify(path: string) {
    try {
      verifyBackup(path);
      const id = this.store.insert('backup_verifications', { path, status: 'passed', message: '' });
      return this.store.get('SELECT * FROM backup_verifications WHERE id=?', id)!;
    } catch (error) {
      this.store.insert('backup_verifications', {
        path,
        status: 'failed',
        message: 'invalidBackup',
      });
      throw error;
    }
  }
  verifyLatest(automatic = false) {
    if (!automatic) this.auth.owner();
    const folder = this.store.settings().backup_folder;
    if (!folder || !existsSync(folder)) throw new AppError('noBackup');
    const file = readdirSync(folder)
      .filter((name) => /^ajith-backup-\d{4}-.*\.db$/.test(name))
      .sort()
      .reverse()[0];
    if (!file) throw new AppError('noBackup');
    return this.verify(join(folder, file));
  }
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
      try {
        verifyBackup(`${path}.partial`);
        renameSync(`${path}.partial`, path);
        this.verify(path);
      } catch (error) {
        if (existsSync(`${path}.partial`)) unlinkSync(`${path}.partial`);
        this.store.insert('backup_verifications', {
          path,
          status: 'failed',
          message: 'invalidBackup',
        });
        throw error;
      }
      this.store.saveSettings({ ...this.store.settings(), last_backup: now() });
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
  async restore(beforeReplace?: () => Promise<void>) {
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
    await beforeReplace?.();
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
    else if (s.backup_folder && !this.store.get('SELECT id FROM backup_verifications LIMIT 1'))
      this.verifyLatest(true);
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
    // Open and read representative restored data, in addition to SQLite integrity checks.
    db.prepare('SELECT id,username,role FROM users LIMIT 1').all();
    db.prepare('SELECT id,bill_no,total FROM sales LIMIT 1').all();
    db.prepare('SELECT id,name_en FROM products LIMIT 1').all();
    if (version.v >= 4) {
      db.prepare('SELECT cashier_pin_hash FROM users LIMIT 1').all();
      db.prepare('SELECT expected_qty,counted_qty FROM stocktake_lines LIMIT 1').all();
      db.prepare('SELECT request_id,supplier_id,total FROM supplier_returns LIMIT 1').all();
    }
    if (
      version.v >= 4 &&
      ![
        'stocktakes',
        'stocktake_lines',
        'supplier_returns',
        'supplier_return_items',
        'backup_verifications',
      ].every((name) => tables.some((table) => table.name === name))
    )
      throw new Error('schema');
  } catch {
    throw new AppError('invalidBackup');
  } finally {
    db?.close();
  }
}

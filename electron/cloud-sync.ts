import { safeStorage } from 'electron';
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { Store } from '../db/database';
import { CloudOutbox } from '../services/cloud-outbox';
import type { CloudStatus } from '../shared/analytics';

interface Vault {
  url: string;
  token: string;
  storeId: string;
  deviceId: string;
  epoch: string;
  lineage: string;
  sequence: number;
  restored?: boolean;
}
export class CloudSync {
  outbox: CloudOutbox;
  private vault?: Vault;
  private busy = false;
  private stopped = false;
  private failures = 0;
  private nextTry = 0;
  private timer?: ReturnType<typeof setInterval>;
  private drainTimer?: ReturnType<typeof setTimeout>;
  private path: string;
  private initialized: Promise<void>;
  constructor(public store: Store) {
    this.outbox = new CloudOutbox(store);
    this.path = join(dirname(store.path), 'cloud-device.secure');
    this.initialized = this.load();
  }
  private async load() {
    if (existsSync(this.path)) {
      try {
        this.vault = JSON.parse(
          (await safeStorage.decryptStringAsync(readFileSync(this.path))).result,
        );
        const m = this.outbox.meta();
        const seq = Number(
          this.store.get("SELECT seq FROM sqlite_sequence WHERE name='cloud_outbox'")?.seq ?? 0,
        );
        const lineage = String(this.store.get('SELECT id FROM cloud_lineage')!.id);
        if (
          this.vault!.restored ||
          this.vault!.epoch !== m.epoch ||
          this.vault!.lineage !== lineage ||
          seq < this.vault!.sequence
        )
          this.pause('The database was restored or replaced. Rebuild the cloud copy to continue.');
      } catch {
        this.pause('Cloud credentials could not be opened. Reconnect this store.');
      }
    } else if (this.outbox.meta().enabled)
      this.pause('Device credentials are missing. Reconnect this store.');
    if (!this.stopped) {
      this.timer = setInterval(() => {
        if (!this.stopped) void this.tick();
      }, 15000);
      this.timer.unref();
      void this.tick();
    }
  }
  private async save() {
    if (!this.vault) return;
    const encrypted = await safeStorage.encryptStringAsync(JSON.stringify(this.vault));
    writeFileSync(`${this.path}.partial`, encrypted, { mode: 0o600 });
    renameSync(`${this.path}.partial`, this.path);
  }
  private pause(error: string) {
    this.store.run('UPDATE cloud_meta SET needs_rebuild=1,error=? WHERE singleton=1', error);
  }
  status(): CloudStatus {
    const m = this.outbox.meta();
    return {
      connected: !!this.vault && !!m.enabled,
      url: this.vault?.url ?? '',
      storeId: String(m.store_id),
      pending: Number(this.store.get('SELECT COUNT(*) n FROM cloud_outbox')!.n),
      quarantined: Number(
        this.store.get('SELECT COUNT(*) n FROM cloud_outbox WHERE quarantined=1')!.n,
      ),
      lastSync: m.last_sync as string | null,
      error: m.error as string | null,
      needsRebuild: !!m.needs_rebuild,
      busy: this.busy,
    };
  }
  private async request(
    path: string,
    body?: unknown,
    token = this.vault?.token,
    base = this.vault?.url,
  ) {
    const response = await fetch(`${base}/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });
    const result = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      if (response.status === 401)
        this.store.run('UPDATE cloud_meta SET enabled=0 WHERE singleton=1');
      if (response.status === 409)
        this.pause('Cloud and local data need reconciliation. Use Rebuild cloud copy.');
      if (response.status === 422 && typeof result.sequence === 'number')
        this.store.run('UPDATE cloud_outbox SET quarantined=1 WHERE sequence=?', result.sequence);
      throw Object.assign(
        new Error(
          response.status === 401
            ? 'Device access expired or was revoked. Reconnect the store.'
            : String(result.error ?? `Cloud request failed (${response.status})`),
        ),
        { status: response.status },
      );
    }
    return result;
  }
  async enroll(url: string, code: string) {
    await this.initialized;
    if (this.busy) throw new Error('Synchronization is busy. Try again shortly.');
    const parsed = new URL(url);
    if (
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.pathname !== '/' ||
      (parsed.protocol !== 'https:' &&
        !(parsed.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(parsed.hostname)))
    )
      throw new Error('Use an HTTPS server address, or localhost for development.');
    this.busy = true;
    try {
      const result = await this.request('/enroll', { code }, undefined, parsed.origin);
      const { storeId, deviceId, token } = result as unknown as {
        storeId: string;
        deviceId: string;
        token: string;
      };
      this.outbox.rebuild(storeId, deviceId);
      this.vault = {
        url: parsed.origin,
        storeId,
        deviceId,
        token,
        epoch: String(this.outbox.meta().epoch),
        lineage: String(this.store.get('SELECT id FROM cloud_lineage')!.id),
        sequence: 0,
      };
      await this.save();
      this.nextTry = 0;
    } finally {
      this.busy = false;
    }
    void this.tick();
    return this.status();
  }
  async rebuild() {
    await this.initialized;
    if (!this.vault || this.busy)
      throw new Error('Connect the store and wait for the current upload to finish.');
    this.busy = true;
    try {
      this.outbox.rebuild(this.vault.storeId, this.vault.deviceId);
      this.vault.epoch = String(this.outbox.meta().epoch);
      // The server accepts this new generation only after an authenticated reset.
      await this.request('/sync/reset', { epoch: this.vault.epoch });
      this.vault.restored = false;
      this.vault.sequence = 0;
      await this.save();
      this.nextTry = 0;
    } finally {
      this.busy = false;
    }
    void this.tick();
    return this.status();
  }
  async disconnect() {
    await this.initialized;
    if (this.busy) throw new Error('Wait for the current upload to finish.');
    if (this.vault) {
      try {
        await this.request('/sync/disconnect', {});
      } catch (error) {
        if ((error as { status?: number }).status !== 401) throw error;
      }
    }
    this.store.run('UPDATE cloud_meta SET enabled=0 WHERE singleton=1');
    this.vault = undefined;
    // Retain encrypted credentials until revocation succeeds, then replace atomically.
    const { unlinkSync } = await import('node:fs');
    if (existsSync(this.path)) unlinkSync(this.path);
    return this.status();
  }
  async tick(force = false) {
    if (
      this.stopped ||
      this.busy ||
      !this.vault ||
      !this.outbox.meta().enabled ||
      this.outbox.meta().needs_rebuild ||
      (!force && Date.now() < this.nextTry)
    )
      return this.status();
    this.busy = true;
    try {
      const events = this.outbox.batch();
      if (events.length) {
        const result = await this.request('/sync/events', { events });
        const sequence = Number(result.acknowledged);
        if (sequence !== events.at(-1)!.sequence) {
          this.pause('Cloud and local checkpoints differ. Rebuild the cloud copy.');
          throw new Error('Incomplete cloud acknowledgement');
        }
        this.vault.sequence = sequence;
        await this.save(); // external high-water mark makes rollback detection conservative
        this.outbox.acknowledge(events, sequence);
      } else if (!this.status().quarantined) {
        const local = this.outbox.fingerprint();
        const remote = await this.request('/sync/reconcile');
        if (
          JSON.stringify(local.counts) !== JSON.stringify(remote.counts) ||
          local.hash !== remote.hash
        )
          this.pause('Cloud totals differ from the store. Rebuild the cloud copy.');
        else
          this.store.run(
            'UPDATE cloud_meta SET last_sync=?,error=NULL WHERE singleton=1',
            new Date().toISOString(),
          );
      }
      this.failures = 0;
      this.nextTry = 0;
    } catch (error) {
      this.failures++;
      this.nextTry =
        Date.now() +
        Math.min(300000, 1000 * 2 ** Math.min(this.failures, 8)) * (0.8 + Math.random() * 0.4);
      this.store.run(
        'UPDATE cloud_meta SET error=? WHERE singleton=1',
        error instanceof Error ? error.message : 'Sync unavailable. Will retry.',
      );
    } finally {
      this.busy = false;
    }
    const status = this.status();
    if (
      !this.stopped &&
      !this.failures &&
      status.connected &&
      status.pending &&
      !status.quarantined &&
      !status.needsRebuild
    ) {
      // Drain successful backfills in bounded, yielding pages rather than waiting
      // for the idle poll between every page. Failed connections retain backoff.
      if (this.drainTimer) clearTimeout(this.drainTimer);
      this.drainTimer = setTimeout(() => {
        this.drainTimer = undefined;
        if (!this.stopped) void this.tick();
      }, 100);
      this.drainTimer.unref();
    }
    return status;
  }
  async stop(restoring = false) {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.drainTimer) clearTimeout(this.drainTimer);
    await this.initialized;
    while (this.busy) await new Promise((r) => setTimeout(r, 25));
    if (restoring && this.vault) {
      this.vault.restored = true;
      await this.save();
    }
  }
}

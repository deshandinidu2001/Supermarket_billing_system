import { createHash, randomUUID } from 'node:crypto';
import { Store } from '../db/database';
import { projection } from '../db/analytics-migration';
import { analyticsColumns, type SyncEvent } from '../shared/analytics';
import { canonical } from '../packages/analytics/engine';

export class CloudOutbox {
  constructor(public store: Store) {}
  meta() {
    return this.store.get('SELECT * FROM cloud_meta WHERE singleton=1')!;
  }
  rebuild(storeId: string, deviceId: string) {
    // A single consistent SQLite snapshot is materialized into durable outbox pages.
    // Upload is resumable; changes after this transaction follow its end marker.
    this.store.db.transaction(() => {
      const epoch = randomUUID();
      this.store.run(
        'UPDATE cloud_meta SET enabled=0,store_id=?,device_id=?,epoch=?,last_sync=NULL,error=NULL,needs_rebuild=0 WHERE singleton=1',
        storeId,
        deviceId,
        epoch,
      );
      this.store.run('DELETE FROM cloud_outbox');
      this.store.run("DELETE FROM sqlite_sequence WHERE name='cloud_outbox'");
      const marker = (kind: string) =>
        this.store.run(
          'INSERT INTO cloud_outbox(id,epoch,record_id,kind) VALUES(?,?,?,?)',
          randomUUID(),
          epoch,
          '',
          kind,
        );
      marker('begin');
      for (const table of Object.keys(analyticsColumns)) {
        this.store.run(
          `INSERT INTO cloud_outbox(id,epoch,entity,record_id,kind,payload) SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-8'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),?,'${table}',id,'upsert',${projection(table)} FROM ${table}`,
          epoch,
        );
      }
      marker('end');
      this.store.run('UPDATE cloud_meta SET enabled=1 WHERE singleton=1');
    })();
  }
  batch(limit = 200): SyncEvent[] {
    const m = this.meta();
    // Stop at a quarantined event rather than skipping a required dependency.
    return this.store
      .all('SELECT * FROM cloud_outbox ORDER BY sequence LIMIT ?', limit)
      .flatMap((row, i, rows) => {
        if (rows.slice(0, i + 1).some((r) => r.quarantined)) return [];
        return [
          {
            id: String(row.id),
            sequence: Number(row.sequence),
            schema: 1 as const,
            storeId: String(m.store_id),
            deviceId: String(m.device_id),
            epoch: String(row.epoch),
            table: row.entity as SyncEvent['table'],
            recordId: String(row.record_id),
            kind: row.kind as SyncEvent['kind'],
            data: row.payload ? JSON.parse(String(row.payload)) : null,
          },
        ];
      });
  }
  acknowledge(events: SyncEvent[], sequence: number) {
    const event = events.find((e) => e.sequence === sequence);
    if (!event || this.meta().epoch !== event.epoch)
      throw new Error('Invalid sync acknowledgement');
    this.store.db.transaction(() => {
      this.store.run(
        'DELETE FROM cloud_outbox WHERE epoch=? AND sequence<=?',
        event.epoch,
        sequence,
      );
      this.store.run(
        'UPDATE cloud_meta SET last_sync=?,error=NULL WHERE singleton=1',
        new Date().toISOString(),
      );
    })();
  }
  fingerprint() {
    const counts: Record<string, number> = {};
    const hash = createHash('sha256');
    for (const table of Object.keys(analyticsColumns)) {
      const rows = this.store.all(`SELECT ${projection(table)} payload FROM ${table} ORDER BY id`);
      counts[table] = rows.length;
      for (const row of rows)
        hash.update(`${table}:${canonical(JSON.parse(String(row.payload)))}\n`);
    }
    return { counts, hash: hash.digest('hex') };
  }
}

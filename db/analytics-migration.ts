import { analyticsColumns } from '../shared/analytics';

const uuid = 'lower(hex(randomblob(16)))';
// randomblob provides UUID entropy; formatting also makes wire validation explicit.
const eventId =
  "lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-8'||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6)))";
export function projection(table: string, prefix = '') {
  if (table === 'settings')
    return `json_object('id',${prefix}id,'shop_name',json_extract(${prefix}value,'$.shop_name'),'expiry_days',json_extract(${prefix}value,'$.expiry_days'),'dead_stock_days',json_extract(${prefix}value,'$.dead_stock_days'))`;
  return `json_object(${analyticsColumns[table as keyof typeof analyticsColumns].map((c) => `'${c}',${prefix}${c}`).join(',')})`;
}
export const analyticsMigration = {
  version: 5,
  sql: `
CREATE TABLE cloud_meta (singleton INTEGER PRIMARY KEY CHECK(singleton=1), enabled INTEGER NOT NULL DEFAULT 0, store_id TEXT NOT NULL DEFAULT '', device_id TEXT NOT NULL DEFAULT '', epoch TEXT NOT NULL DEFAULT '', last_sync TEXT, error TEXT, needs_rebuild INTEGER NOT NULL DEFAULT 0);
INSERT INTO cloud_meta(singleton) VALUES(1);
CREATE TABLE cloud_outbox (sequence INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, epoch TEXT NOT NULL, entity TEXT, record_id TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT, quarantined INTEGER NOT NULL DEFAULT 0);
CREATE INDEX idx_cloud_pending ON cloud_outbox(quarantined, sequence);
${Object.keys(analyticsColumns)
  .map((table) =>
    ['INSERT', 'UPDATE', 'DELETE']
      .map((op) => {
        const ref = op === 'DELETE' ? 'OLD' : 'NEW';
        return `CREATE TRIGGER cloud_${table}_${op.toLowerCase()} AFTER ${op} ON ${table}
    WHEN (SELECT enabled FROM cloud_meta WHERE singleton=1)=1
    BEGIN INSERT INTO cloud_outbox(id,epoch,entity,record_id,kind,payload)
    SELECT ${eventId},epoch,'${table}',${ref}.id,'${op === 'DELETE' ? 'delete' : 'upsert'}',${op === 'DELETE' ? 'NULL' : projection(table, `${ref}.`)} FROM cloud_meta WHERE singleton=1; END;`;
      })
      .join('\n'),
  )
  .join('\n')}
-- Reserved lineage marker is deliberately independent of operational identifiers.
CREATE TABLE cloud_lineage (id TEXT PRIMARY KEY DEFAULT (${uuid}));
INSERT INTO cloud_lineage DEFAULT VALUES;
`,
};

import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { pool, transaction } from './db';
import {
  analyticsColumns,
  eventSchema,
  validPayload,
  forecastSettingsSchema,
  type Dataset,
} from '../../../shared/analytics';
import {
  analytics,
  forecasts,
  canonical,
  localDay,
  addDays,
} from '../../../packages/analytics/engine';
import { answerKnown, generateSql, validateSql } from './questions';

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const fail = (status: number, message: string) =>
  Object.assign(new Error(message), { status, expose: true });
const wrap =
  (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next);
  };
const uuid = z.string().uuid();
export const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(express.json({ limit: '2mb' }));
app.use(
  '/api',
  rateLimit({ windowMs: 60000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false }),
);
app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.headers.origin)
    return next(
      fail(403, 'Use the POS application or native mobile app. Browser access is not supported.'),
    );
  next();
});
app.get(
  '/api/health',
  wrap(async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  }),
);
const authLimiter = () =>
  rateLimit({ windowMs: 60000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false });
app.post(
  '/api/auth/login',
  authLimiter(),
  wrap(async (req, res) => {
    const input = z
      .object({
        email: z.string().email().max(200),
        password: z.string().min(1).max(200),
        client: z.enum(['desktop', 'mobile']).default('desktop'),
      })
      .parse(req.body);
    const result = await pool.query('SELECT * FROM owners WHERE email=$1', [
      input.email.toLowerCase().trim(),
    ]);
    const owner = result.rows[0];
    if (!owner || !(await bcrypt.compare(input.password, owner.password_hash)))
      throw fail(401, 'Email or password is incorrect.');
    const session = token();
    await pool.query("INSERT INTO sessions VALUES($1,$2,now()+interval '24 hours')", [
      digest(session),
      owner.id,
    ]);
    res.json({ ownerId: owner.id, token: session, expiresIn: 86400 });
  }),
);
const owner = (req: Request, res: Response, next: NextFunction) => {
  void (async () => {
    const raw = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!raw) throw fail(401, 'Sign in to continue.');
    const session = await pool.query(
      'SELECT owner_id FROM sessions WHERE token_hash=$1 AND expires_at>now()',
      [digest(raw)],
    );
    if (!session.rowCount) throw fail(401, 'Your session expired. Sign in again.');
    res.locals.ownerId = session.rows[0].owner_id;
    res.locals.sessionHash = digest(raw);
    next();
  })().catch(next);
};
app.post(
  '/api/auth/logout',
  owner,
  wrap(async (_req, res) => {
    await pool.query('DELETE FROM sessions WHERE token_hash=$1', [res.locals.sessionHash]);
    res.json({ ok: true });
  }),
);
app.get(
  '/api/stores',
  owner,
  wrap(async (_req, res) => {
    const ids = await pool.query('SELECT store_id FROM memberships WHERE owner_id=$1', [
      res.locals.ownerId,
    ]);
    const stores = await Promise.all(
      ids.rows.map((r) =>
        transaction(
          async (c) =>
            (
              await c.query('SELECT id,name,timezone,last_synced FROM stores WHERE id=$1', [
                r.store_id,
              ])
            ).rows[0],
          r.store_id,
        ),
      ),
    );
    res.json(stores);
  }),
);
const storeRouter = express.Router({ mergeParams: true });
app.use('/api/stores/:storeId', owner, storeRouter);
storeRouter.use((req, res, next) => {
  void (async () => {
    const id = uuid.parse(req.params.storeId);
    const member = await pool.query('SELECT 1 FROM memberships WHERE owner_id=$1 AND store_id=$2', [
      res.locals.ownerId,
      id,
    ]);
    if (!member.rowCount) throw fail(403, 'Store access denied.');
    res.locals.storeId = id;
    next();
  })().catch(next);
});
storeRouter.post(
  '/enrollment',
  wrap(async (_req, res) => {
    const code = token();
    await pool.query("INSERT INTO enrollments VALUES($1,$2,now()+interval '10 minutes')", [
      digest(code),
      res.locals.storeId,
    ]);
    res.json({ code, expiresIn: 600 });
  }),
);
storeRouter.get(
  '/devices',
  wrap(async (_req, res) => {
    res.json(
      (
        await pool.query('SELECT id,revoked,last_sequence FROM devices WHERE store_id=$1', [
          res.locals.storeId,
        ])
      ).rows,
    );
  }),
);
storeRouter.post(
  '/devices/:deviceId/revoke',
  wrap(async (req, res) => {
    await pool.query('UPDATE devices SET revoked=true WHERE id=$1 AND store_id=$2', [
      uuid.parse(req.params.deviceId),
      res.locals.storeId,
    ]);
    res.json({ ok: true });
  }),
);
app.post(
  '/api/enroll',
  authLimiter(),
  wrap(async (req, res) => {
    const { code } = z.object({ code: z.string().min(20).max(200) }).parse(req.body);
    const deviceId = randomUUID(),
      secret = token();
    const storeId = await transaction(async (c) => {
      const enrollment = await c.query(
        'DELETE FROM enrollments WHERE code_hash=$1 AND expires_at>now() RETURNING store_id',
        [digest(code)],
      );
      if (!enrollment.rowCount) throw fail(401, 'Enrollment code expired or was already used.');
      const id = enrollment.rows[0].store_id;
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [id]);
      await c.query('UPDATE devices SET revoked=true WHERE store_id=$1', [id]);
      await c.query('INSERT INTO devices(id,store_id,token_hash) VALUES($1,$2,$3)', [
        deviceId,
        id,
        digest(secret),
      ]);
      return id;
    });
    res.json({ storeId, deviceId, token: secret });
  }),
);
const sync = express.Router();
app.use('/api/sync', sync);
sync.use((req, res, next) => {
  void (async () => {
    const raw = req.headers.authorization?.replace(/^Bearer /, '');
    if (!raw) throw fail(401, 'Device authentication required.');
    const device = await pool.query('SELECT * FROM devices WHERE token_hash=$1 AND NOT revoked', [
      digest(raw),
    ]);
    if (!device.rowCount) throw fail(401, 'Device access revoked.');
    res.locals.device = device.rows[0];
    next();
  })().catch(next);
});
sync.post(
  '/disconnect',
  wrap(async (_req, res) => {
    await pool.query('UPDATE devices SET revoked=true WHERE id=$1', [res.locals.device.id]);
    res.json({ ok: true });
  }),
);
sync.post(
  '/reset',
  wrap(async (req, res) => {
    const epoch = uuid.parse(req.body.epoch),
      device = res.locals.device;
    await transaction(async (c) => {
      if (
        !(
          await c.query('SELECT id FROM devices WHERE id=$1 AND NOT revoked FOR UPDATE', [
            device.id,
          ])
        ).rowCount
      )
        throw fail(401, 'Device access revoked.');
      if (
        (
          await c.query('SELECT 1 FROM sync_events WHERE device_id=$1 AND epoch=$2', [
            device.id,
            epoch,
          ])
        ).rowCount
      )
        throw fail(409, 'Choose a new rebuild generation.');
      await c.query('UPDATE devices SET epoch=$1,last_sequence=0 WHERE id=$2', [epoch, device.id]);
      await c.query(
        'DELETE FROM analytics_records WHERE store_id=$1 AND epoch<>COALESCE((SELECT visible_epoch FROM stores WHERE id=$1),$2)',
        [device.store_id, epoch],
      );
    }, device.store_id);
    res.json({ ok: true });
  }),
);
sync.post(
  '/events',
  wrap(async (req, res) => {
    const { events } = z.object({ events: z.array(eventSchema).min(1).max(200) }).parse(req.body);
    const device = res.locals.device;
    for (const event of events)
      if (!validPayload(event))
        throw Object.assign(fail(422, 'Invalid analytics event. Rebuild to recover.'), {
          sequence: event.sequence,
        });
    const acknowledged = await transaction(async (c) => {
      const locked = await c.query('SELECT * FROM devices WHERE id=$1 AND NOT revoked FOR UPDATE', [
        device.id,
      ]);
      if (!locked.rowCount) throw fail(401, 'Device access revoked.');
      const d = locked.rows[0];
      if (events.at(-1)!.sequence < Number(d.last_sequence))
        throw fail(409, 'The local checkpoint is behind the cloud. Rebuild required.');
      let sequence = Number(d.last_sequence),
        epoch = d.epoch;
      for (const e of events) {
        if (e.storeId !== d.store_id || e.deviceId !== d.id)
          throw fail(403, 'Device cannot synchronize another store.');
        if (epoch && e.epoch !== epoch)
          throw fail(409, 'Obsolete database generation. Rebuild required.');
        const hash = digest(JSON.stringify(e));
        const previous = await c.query(
          'SELECT digest FROM sync_events WHERE device_id=$1 AND epoch=$2 AND sequence=$3',
          [d.id, e.epoch, e.sequence],
        );
        if (previous.rowCount) {
          if (previous.rows[0].digest !== hash) throw fail(409, 'Event identity conflict.');
          continue;
        }
        if (!epoch && e.sequence === 1 && e.kind === 'begin') epoch = e.epoch;
        if (e.epoch !== epoch || e.sequence !== sequence + 1)
          throw fail(409, 'Event sequence mismatch. Rebuild required.');
        if (sequence === 0 && e.kind !== 'begin')
          throw fail(409, 'A snapshot begin marker is required.');
        if (e.kind === 'begin') {
          if (e.sequence !== 1) throw fail(409, 'Unexpected snapshot boundary.');
          await c.query('DELETE FROM analytics_records WHERE store_id=$1 AND epoch=$2', [
            d.store_id,
            epoch,
          ]);
        } else if (e.kind === 'end') {
          await c.query('UPDATE stores SET visible_epoch=$1,last_synced=now() WHERE id=$2', [
            epoch,
            d.store_id,
          ]);
          await c.query('DELETE FROM analytics_records WHERE store_id=$1 AND epoch<>$2', [
            d.store_id,
            epoch,
          ]);
        } else if (e.kind === 'delete')
          await c.query(
            'DELETE FROM analytics_records WHERE store_id=$1 AND epoch=$2 AND table_name=$3 AND record_id=$4',
            [d.store_id, epoch, e.table, e.recordId],
          );
        else
          await c.query(
            'INSERT INTO analytics_records VALUES($1,$2,$3,$4,$5) ON CONFLICT(store_id,epoch,table_name,record_id) DO UPDATE SET data=excluded.data',
            [d.store_id, epoch, e.table, e.recordId, JSON.stringify(e.data)],
          );
        await c.query('INSERT INTO sync_events VALUES($1,$2,$3,$4,$5,$6)', [
          d.store_id,
          d.id,
          epoch,
          e.sequence,
          e.id,
          hash,
        ]);
        sequence = e.sequence;
      }
      await c.query('UPDATE devices SET epoch=$1,last_sequence=$2 WHERE id=$3', [
        epoch,
        sequence,
        d.id,
      ]);
      await c.query('UPDATE stores SET last_synced=now() WHERE id=$1 AND visible_epoch=$2', [
        d.store_id,
        epoch,
      ]);
      return sequence;
    }, device.store_id);
    res.json({ acknowledged });
  }),
);

async function load(storeId: string) {
  return transaction(
    async (c) => {
      const store = (
        await c.query(
          'SELECT id,name,timezone,last_synced,forecast,visible_epoch FROM stores WHERE id=$1',
          [storeId],
        )
      ).rows[0];
      const result = await c.query(
        'SELECT table_name,data FROM analytics_records WHERE store_id=$1 AND epoch=$2 ORDER BY table_name,record_id LIMIT 250001',
        [storeId, store.visible_epoch],
      );
      if (result.rows.length > 250000)
        throw fail(503, 'This store needs an expanded analytics capacity configuration.');
      const data: Dataset = {};
      for (const r of result.rows) (data[r.table_name as keyof Dataset] ??= []).push(r.data);
      return { store, data };
    },
    storeId,
    true,
  );
}
sync.get(
  '/reconcile',
  wrap(async (_req, res) => {
    const id = res.locals.device.store_id,
      { data } = await load(id),
      hash = createHash('sha256'),
      counts: Record<string, number> = {};
    for (const table of Object.keys(analyticsColumns) as (keyof Dataset)[]) {
      const rows = data[table] ?? [];
      counts[table] = rows.length;
      for (const r of rows) hash.update(`${table}:${canonical(r)}\n`);
    }
    await transaction((c) => c.query('UPDATE stores SET last_synced=now() WHERE id=$1', [id]), id);
    res.json({ counts, hash: hash.digest('hex') });
  }),
);
const rangeSchema = z
  .object({ from: z.string().date(), to: z.string().date() })
  .refine(
    (r) => r.from <= r.to && (Date.parse(r.to) - Date.parse(r.from)) / 86400000 <= 366,
    'Choose a reporting period of at most 367 days.',
  );
storeRouter.get(
  '/analytics',
  wrap(async (req, res) => {
    const { store, data } = await load(res.locals.storeId),
      today = localDay(new Date().toISOString(), store.timezone);
    const range = rangeSchema.parse({
      from: req.query.from || addDays(today, -29),
      to: req.query.to || today,
    });
    res.json({
      store,
      report: analytics(data, range.from, range.to, store.timezone),
      forecasts: forecasts(data, forecastSettingsSchema.parse(store.forecast), store.timezone),
      forecastSettings: forecastSettingsSchema.parse(store.forecast),
    });
  }),
);
storeRouter.get(
  '/sales/:saleId',
  wrap(async (req, res) => {
    const { data } = await load(res.locals.storeId),
      id = uuid.parse(req.params.saleId),
      sale = data.sales?.find((s) => s.id === id);
    if (!sale) throw fail(404, 'Sale not found.');
    res.json({
      sale,
      items: (data.sale_items ?? []).filter((i) => i.sale_id === id),
      payments: (data.payments ?? []).filter((p) => p.sale_id === id),
      returns: (data.returns ?? []).filter((r) => r.sale_id === id),
    });
  }),
);
storeRouter.post(
  '/forecast-settings',
  wrap(async (req, res) => {
    const settings = forecastSettingsSchema.parse(req.body);
    await transaction(
      (c) =>
        c.query('UPDATE stores SET forecast=$1 WHERE id=$2', [
          JSON.stringify(settings),
          res.locals.storeId,
        ]),
      res.locals.storeId,
    );
    res.json(settings);
  }),
);
storeRouter.get(
  '/questions',
  wrap(async (_req, res) => {
    res.json(
      (
        await pool.query(
          'SELECT question,created_at FROM questions WHERE owner_id=$1 AND store_id=$2 ORDER BY created_at DESC LIMIT 10',
          [res.locals.ownerId, res.locals.storeId],
        )
      ).rows,
    );
  }),
);
storeRouter.post(
  '/questions',
  wrap(async (req, res) => {
    const { question } = z.object({ question: z.string().trim().min(3).max(500) }).parse(req.body);
    const { store, data } = await load(res.locals.storeId);
    let answer: unknown = answerKnown(question, data, store.timezone);
    if (!answer) {
      const sql = await generateSql(question);
      if (!sql)
        throw fail(
          503,
          'Broader AI questions are unavailable. Try one of the suggested questions.',
        );
      answer = await transaction(
        async (c) => {
          await c.query('SET LOCAL ROLE ajith_analytics_reader');
          await c.query("SET LOCAL statement_timeout='1500ms'");
          const safe = validateSql(sql),
            explain = await c.query(`EXPLAIN (FORMAT JSON) ${safe}`);
          if (explain.rows[0]['QUERY PLAN'][0].Plan['Total Cost'] > 100000)
            throw fail(422, 'Question is too expensive. Narrow the request.');
          const result = await c.query(`SELECT * FROM (${safe}) answer LIMIT 100`);
          return {
            interpretation: question,
            rows: result.rows,
            from: null,
            to: null,
            limitedTo: 100,
          };
        },
        res.locals.storeId,
        true,
      );
    }
    await pool.query('INSERT INTO questions(id,owner_id,store_id,question) VALUES($1,$2,$3,$4)', [
      randomUUID(),
      res.locals.ownerId,
      res.locals.storeId,
      question,
    ]);
    res.json({ answer, lastSynced: store.last_synced });
  }),
);
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const e = error as { status?: number; message?: string; sequence?: number; expose?: boolean };
  const status = error instanceof z.ZodError ? 400 : (e.status ?? 500);
  res.status(status).json({
    error:
      status < 500 || e.expose
        ? e.message
        : 'The analytics service is unavailable. Try again shortly.',
    ...(e.sequence ? { sequence: e.sequence } : {}),
  });
});

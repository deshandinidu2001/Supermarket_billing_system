import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { app } from '../src/app';
import { pool, transaction } from '../src/db';
import { validateSql, answerKnown, questionRange } from '../src/questions';
import { forecastSeries } from '../../../packages/analytics/engine';
import type { SyncEvent } from '../../../shared/analytics';

if (
  !process.env.DATABASE_URL ||
  !new URL(process.env.DATABASE_URL).pathname.startsWith('/ajith_test_')
)
  throw new Error('Tests require a dedicated ajith_test_* PostgreSQL database.');
const server = app.listen(0, '127.0.0.1');
await new Promise<void>((r) => server.once('listening', r));
const address = server.address() as { port: number },
  base = `http://127.0.0.1:${address.port}/api`;
after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await pool.end();
});
async function api(path: string, body?: unknown, token?: string, cookie?: string) {
  const response = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    data: await response.json(),
    cookie: response.headers.get('set-cookie'),
  };
}
async function createOwner() {
  const id = randomUUID(),
    store = randomUUID(),
    email = `${id}@test.invalid`,
    password = 'Test-cloud-owner-123!';
  await transaction(async (c) => {
    await c.query('INSERT INTO owners VALUES($1,$2,$3)', [
      id,
      email,
      await bcrypt.hash(password, 4),
    ]);
    await c.query('INSERT INTO stores(id,name) VALUES($1,$2)', [store, 'Isolated Test Store']);
    await c.query('INSERT INTO memberships VALUES($1,$2)', [id, store]);
  }, store);
  const login = await api('/auth/login', { email, password, client: 'mobile' });
  assert.equal(login.status, 200);
  const code = await api(`/stores/${store}/enrollment`, {}, login.data.token),
    device = await api('/enroll', { code: code.data.code });
  assert.equal(device.status, 200);
  assert.equal(
    (await api('/enroll', { code: code.data.code })).status,
    401,
    'enrollment code is single use',
  );
  return {
    id,
    store,
    email,
    password,
    token: login.data.token,
    device: device.data,
    cookie: login.cookie!.split(';')[0],
  };
}
test('full synchronization, staged snapshots, financial parity, tenant isolation and revocation', async () => {
  const a = await createOwner(),
    b = await createOwner();
  assert.equal((await api(`/stores/${a.store}/analytics`, undefined, b.token)).status, 403);
  assert.equal(
    (await api(`/stores/${a.store}/analytics`, undefined, undefined, a.cookie)).status,
    200,
    'web session cookie authenticates',
  );
  assert.equal(
    (await api('/stores', undefined, a.device.token)).status,
    401,
    'device cannot use owner APIs',
  );
  const fixture = JSON.parse(readFileSync(process.env.ANALYTICS_FIXTURE!, 'utf8')) as {
    events: SyncEvent[];
    expected: unknown;
    from: string;
    to: string;
  };
  const events = fixture.events.map((e) => ({
    ...e,
    storeId: a.store,
    deviceId: a.device.deviceId,
  }));
  for (let i = 0; i < events.length; i += 200) {
    const batch = events.slice(i, i + 200),
      result = await api('/sync/events', { events: batch }, a.device.token);
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(
      (await api('/sync/events', { events: batch }, a.device.token)).status,
      200,
      'retry deduplicates entire batch',
    );
    if (i === 0) {
      const staged = await api(
        `/stores/${a.store}/analytics?from=${fixture.from}&to=${fixture.to}`,
        undefined,
        a.token,
      );
      assert.equal(staged.data.report.summary.revenue, 0, 'partial backfill remains invisible');
    }
  }
  const cloud = await api(
    `/stores/${a.store}/analytics?from=${fixture.from}&to=${fixture.to}`,
    undefined,
    a.token,
  );
  assert.equal(cloud.status, 200);
  assert.deepEqual(cloud.data.report.summary, fixture.expected);
  const reconcile = await api('/sync/reconcile', undefined, a.device.token);
  assert.equal(reconcile.status, 200);
  assert.equal(reconcile.data.hash.length, 64);
  const other = await api(`/stores/${b.store}/analytics`, undefined, b.token);
  assert.equal(other.data.report.products.length, 0);
  const leaked = await transaction(
    async (c) => {
      await c.query('SET LOCAL ROLE ajith_analytics_reader');
      return (await c.query('SELECT DISTINCT store_id FROM analytics_records')).rows;
    },
    b.store,
    true,
  );
  assert.equal(leaked.length, 0, 'database RLS isolates AI reader');
  const injected = {
    ...events.at(-1)!,
    id: randomUUID(),
    sequence: events.at(-1)!.sequence + 1,
    storeId: b.store,
  };
  assert.equal((await api('/sync/events', { events: [injected] }, a.device.token)).status, 403);
  const gap = { ...events.at(-1)!, id: randomUUID(), sequence: events.at(-1)!.sequence + 2 };
  assert.equal((await api('/sync/events', { events: [gap] }, a.device.token)).status, 409);
  assert.equal(
    (await api(`/stores/${a.store}/questions`, { question: 'top 5 items this week' }, a.token))
      .status,
    200,
  );
  const badPayload = {
    ...events.find((e) => e.table === 'products')!,
    id: randomUUID(),
    sequence: events.at(-1)!.sequence + 1,
  };
  badPayload.data = { ...badPayload.data, password_hash: 'must never upload' };
  assert.equal((await api('/sync/events', { events: [badPayload] }, a.device.token)).status, 422);
  const resetEpoch = randomUUID();
  assert.equal((await api('/sync/reset', { epoch: resetEpoch }, a.device.token)).status, 200);
  const old = (
    await api(
      `/stores/${a.store}/analytics?from=${fixture.from}&to=${fixture.to}`,
      undefined,
      a.token,
    )
  ).data.report.summary;
  const begin = { ...events[0], epoch: resetEpoch, id: randomUUID() };
  assert.equal((await api('/sync/events', { events: [begin] }, a.device.token)).status, 200);
  assert.deepEqual(
    (
      await api(
        `/stores/${a.store}/analytics?from=${fixture.from}&to=${fixture.to}`,
        undefined,
        a.token,
      )
    ).data.report.summary,
    old,
    'rebuild keeps prior complete generation visible',
  );
  assert.equal(
    (await api('/sync/events', { events: [events.at(-1)] }, a.device.token)).status,
    409,
    'restored old stream is rejected',
  );
  await api(`/stores/${a.store}/devices/${a.device.deviceId}/revoke`, {}, a.token);
  assert.equal((await api('/sync/reconcile', undefined, a.device.token)).status, 401);
  await api('/auth/logout', {}, a.token);
  assert.equal((await api('/stores', undefined, a.token)).status, 401);
});
test('SQL safety, timezone questions and chronological forecast evaluation', () => {
  assert.doesNotThrow(() =>
    validateSql(
      "SELECT sum((data->>'total')::numeric) AS revenue FROM analytics_data WHERE table_name='sales'",
    ),
  );
  for (const sql of [
    'DELETE FROM analytics_data',
    'SELECT * FROM owners',
    'SELECT * FROM analytics_data; SELECT 1',
    'SELECT pg_sleep(30) FROM analytics_data',
    'SELECT * FROM analytics_data a JOIN analytics_data b ON true',
    'SELECT (SELECT password_hash FROM owners) FROM analytics_data',
    'SELECT * INTO stolen FROM analytics_data',
    'SELECT public.sum(1) FROM analytics_data',
  ])
    assert.throws(() => validateSql(sql), sql);
  assert.deepEqual(questionRange('this week', 'Asia/Colombo', new Date('2026-11-08T20:00:00Z')), {
    from: '2026-11-09',
    to: '2026-11-09',
  });
  assert.equal(answerKnown('unknown unusual question', {}, 'Asia/Colombo'), null);
  assert.equal(forecastSeries([1, 2, 3], 7).method, 'insufficient');
  const values = Array.from({ length: 56 }, (_, i) => [1, 2, 4, 2, 3, 12, 14][i % 7]),
    f = forecastSeries(values, 7);
  assert.equal(f.method, 'seasonal');
  assert.equal(f.mae, 0);
  assert.equal(f.backtestDays, 28);
});
test('real Electron sync worker handles encrypted credentials, offline writes and restore recovery', async () => {
  const owner = await createOwner(),
    enrollment = await api(`/stores/${owner.store}/enrollment`, {}, owner.token);
  const require = createRequire(new URL('../../../package.json', import.meta.url)),
    electron = require('electron') as string;
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ANALYTICS_URL: base.replace(/\/api$/, ''),
    ANALYTICS_ENROLLMENT: enrollment.data.code,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [resolve('../../dist-electron/cloud-sync-driver.cjs')], {
    env,
    windowsHide: true,
    stdio: 'pipe',
  });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  const code = await new Promise<number | null>((r, reject) => {
    child.once('error', reject);
    child.once('exit', r);
  });
  assert.equal(code, 0, output);
  assert.doesNotMatch(output, /UnhandledPromiseRejection|database connection is not open/);
  console.log(output.trim());
});
test('owner web works at desktop and phone widths with real synchronized fixtures', async () => {
  process.env.WEB_ORIGIN = base.replace(/\/api$/, '');
  const require = createRequire(new URL('../../../package.json', import.meta.url));
  const { chromium } = require('playwright') as typeof import('playwright');
  const owner = await createOwner(),
    fixture = JSON.parse(readFileSync(process.env.ANALYTICS_FIXTURE!, 'utf8')) as {
      events: SyncEvent[];
      from: string;
      to: string;
    };
  const events = fixture.events.map((e) => ({
    ...e,
    storeId: owner.store,
    deviceId: owner.device.deviceId,
  }));
  for (let i = 0; i < events.length; i += 200)
    assert.equal(
      (await api('/sync/events', { events: events.slice(i, i + 200) }, owner.device.token)).status,
      200,
    );
  const browser = await chromium.launch({
    headless: true,
    ...(existsSync('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe')
      ? { channel: 'msedge' }
      : {}),
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }),
      page = await context.newPage(),
      errors: string[] = [];
    page.setDefaultTimeout(15000);
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base.replace(/\/api$/, ''));
    await page.getByLabel('Email', { exact: true }).fill(owner.email);
    await page.getByLabel('Password', { exact: true }).fill(owner.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Products driving sales' }).waitFor();
    mkdirSync(resolve('../../test-results'), { recursive: true });
    await page.locator('.recharts-area-area').waitFor();
    await page.mouse.move(0, 0);
    await page.screenshot({
      path: resolve('../../test-results/owner-web-desktop.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Inventory', exact: true }).first().click();
    await page.getByRole('heading', { name: 'Slow-moving products' }).waitFor();
    await page.getByRole('button', { name: 'AI analyst', exact: true }).click();
    await page
      .getByRole('button', { name: 'What are the top 5 items this week?', exact: true })
      .click();
    await page.getByRole('heading', { name: 'Top 5 products by quantity' }).waitFor();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('button', { name: 'Create enrollment code' }).click();
    await page.locator('.enrollment-code').waitFor();
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.recharts-area-area').waitFor();
    await page.screenshot({
      path: resolve('../../test-results/owner-web-phone.png'),
      fullPage: true,
    });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      'phone view has no page-level horizontal overflow',
    );
    await page.getByRole('button', { name: 'Alerts', exact: true }).click();
    await page.getByRole('heading', { name: 'Expiring within 7 days' }).waitFor();
    assert.deepEqual(errors, []);
    await context.close();
  } finally {
    await browser.close();
  }
});

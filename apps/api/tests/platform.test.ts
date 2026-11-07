import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { app } from '../src/app';
import { pool, transaction } from '../src/db';
import { validateSql, answerKnown, questionRange } from '../src/questions';
import { forecastSeries } from '../../../packages/analytics/engine';
import type { SyncEvent } from '../../../shared/analytics';
import type {} from '../../../shared/contracts';

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
  };
}
test('full synchronization, staged snapshots, financial parity, tenant isolation and revocation', async () => {
  const a = await createOwner(),
    b = await createOwner();
  assert.equal((await api(`/stores/${a.store}/analytics`, undefined, b.token)).status, 403);
  assert.equal(
    (await api(`/stores/${a.store}/analytics`, undefined, undefined, `ajith_session=${a.token}`))
      .status,
    401,
    'browser cookie authentication is not supported',
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
test('POS analytics tabs, direct pairing, offline gate, local checkout and session isolation', async () => {
  const require = createRequire(new URL('../../../package.json', import.meta.url));
  const { _electron: electron } = require('playwright') as typeof import('playwright');
  const owner = await createOwner(),
    directory = mkdtempSync(join(tmpdir(), 'ajith-pos-analytics-'));
  const env: NodeJS.ProcessEnv = { ...process.env, POS_DATA_DIR: directory, POS_DEMO: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  const desktop = await electron.launch({
    args: [resolve('../..')],
    env: Object.fromEntries(
      Object.entries(env).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string',
      ),
    ),
    timeout: 60000,
  });
  const rendererRequests: string[] = [],
    errors: string[] = [];
  try {
    const page = await desktop.firstWindow();
    page.setDefaultTimeout(20000);
    page.on('request', (r) => {
      if (/^https?:/.test(r.url())) rendererRequests.push(r.url());
    });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.getByLabel('Username', { exact: true }).fill('owner');
    await page.getByLabel('Password', { exact: true }).fill('ajith123');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByLabel('Current password', { exact: true }).fill('ajith123');
    await page
      .getByLabel('New password (at least 8 characters)', { exact: true })
      .fill('desktop-analytics-2026');
    await page.getByLabel('Owner approval PIN (4–6 digits)', { exact: true }).fill('4321');
    await page.getByRole('button', { name: 'Save password', exact: true }).click();
    await page.locator('.nav-link[href="#/analytics"]').click();
    await page.getByRole('tab', { name: 'Connection', exact: true }).click();
    await page.getByLabel('Server address', { exact: true }).fill(base.replace(/\/api$/, ''));
    await page.getByLabel('Email', { exact: true }).fill(owner.email);
    await page.getByLabel('Password', { exact: true }).fill(owner.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page
      .getByRole('button', { name: 'Connect this POS', exact: true })
      .waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Connect this POS', exact: true }).click();
    await page.waitForFunction(
      async () => {
        const r = await window.pos.invoke('cloudStatus', {});
        return r.ok && r.data.pending === 0 && !!r.data.lastSync;
      },
      undefined,
      { timeout: 60000 },
    );
    // Check the visible server projection as well as the local upload queue.
    let projection;
    for (let attempt = 0; attempt < 100; attempt++) {
      projection = await api(
        `/stores/${owner.store}/analytics?from=2026-01-01&to=2026-12-31`,
        undefined,
        owner.token,
      );
      if (projection.data.report.summary.bills > 0) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert(
      projection?.data.report.summary.bills > 0,
      'paired POS data must be visible on the server',
    );
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByRole('tab', { name: 'Overview', exact: true }).click();
    await page.locator('.oa-metrics').waitFor();
    await page.locator('.oa-table tbody tr').first().waitFor();
    await page.locator('.recharts-area-area').waitFor({ state: 'attached' });
    mkdirSync(resolve('../../test-results'), { recursive: true });
    await page.screenshot({
      path: resolve('../../test-results/pos-analytics-overview.png'),
      fullPage: true,
    });
    const status = await page.evaluate(() => window.pos.invoke('analyticsStatus', {}));
    assert(status.ok);
    assert(!JSON.stringify(status.data).includes(owner.password));
    assert(!JSON.stringify(status.data).includes('"token"'));
    await page.getByRole('tab', { name: 'AI analyst', exact: true }).click();
    await page
      .getByRole('button', { name: 'What are the top 5 items this week?', exact: true })
      .click();
    await page.getByRole('heading', { name: 'Top 5 products by quantity' }).waitFor();
    await page.getByRole('tab', { name: 'Sales', exact: true }).click();
    await page.locator('.oa-row-link').first().click();
    await page.getByRole('dialog').waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.getByRole('tab', { name: 'Inventory', exact: true }).click();
    await page.locator('.oa-table tbody tr').first().waitFor();
    await page.getByRole('tab', { name: 'Forecasts', exact: true }).click();
    await page.locator('.oa-table tbody tr').first().waitFor();
    await page.getByRole('tab', { name: 'Alerts', exact: true }).click();
    await page.getByRole('heading', { name: 'Expiring within 7 days' }).waitFor();
    await desktop.evaluate(() => {
      const globals = globalThis as typeof globalThis & { analyticsTestFetch?: typeof fetch };
      globals.analyticsTestFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        throw new Error('Simulated network loss');
      };
    });
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.locator('.oa-network-gate').waitFor();
    assert.equal(await page.locator('.oa-metrics').count(), 0);
    await page.locator('.nav-link[href="#/checkout"]').click();
    await page.getByRole('heading', { name: 'Checkout', exact: true }).waitFor();
    await page.getByRole('button', { name: /Fresh milk/ }).click();
    await page.locator('.cart-table tbody tr').first().waitFor();
    await desktop.evaluate(() => {
      const globals = globalThis as typeof globalThis & { analyticsTestFetch?: typeof fetch };
      globalThis.fetch = globals.analyticsTestFetch!;
      delete globals.analyticsTestFetch;
    });
    await page.locator('.nav-link[href="#/analytics"]').click();
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.getByRole('tab', { name: 'Overview', exact: true }).click();
    await page.locator('.oa-metrics').waitFor();
    await desktop.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.setMinimumSize(0, 0);
      win.setSize(390, 844);
    });
    await page.screenshot({
      path: resolve('../../test-results/pos-analytics-small.png'),
      fullPage: true,
    });
    assert.equal(await page.evaluate(() => document.body.scrollWidth > innerWidth), false);
    await desktop.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1366, 900),
    );
    await page.getByRole('button', { name: 'Lock screen', exact: true }).click();
    await page.getByLabel('Username', { exact: true }).fill('owner');
    await page.getByLabel('Password', { exact: true }).fill('desktop-analytics-2026');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.locator('.nav-link[href="#/analytics"]').click();
    await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
    assert.equal((await page.evaluate(() => window.pos.invoke('analyticsStatus', {}))).ok, true);
    assert.deepEqual(rendererRequests, []);
    assert.deepEqual(errors, []);
  } catch (error) {
    const page = await desktop.firstWindow();
    console.error('Original POS analytics test failure',error);
    console.log('POS failure state',(await page.locator('body').innerText()).slice(0,3800));
    throw error;
  } finally {
    await desktop.close();
  }
});

test('browser dashboard, browser-origin requests and cookie login are removed', async () => {
  const root = await fetch(base.replace(/\/api$/, ''));
  assert.equal(root.status, 404);
  const browser = await fetch(base + '/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:4310' },
    body: JSON.stringify({
      email: 'browser@test.invalid',
      password: 'example-password',
      client: 'desktop',
    }),
  });
  assert.equal(browser.status, 403);
  const legacy = await api('/auth/login', {
    email: 'browser@test.invalid',
    password: 'example-password',
    client: 'web',
  });
  assert.equal(legacy.status, 400);
});

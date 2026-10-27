import { _electron as electron } from 'playwright/test';
import { mkdtempSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
const path = resolve('release/win-unpacked/Ajith Super Market.exe');
const data = mkdtempSync(join(tmpdir(), 'ajith-packaged-'));
const env = { ...process.env, POS_DATA_DIR: data };
delete env.ELECTRON_RUN_AS_NODE;
delete env.POS_DEMO;
delete env.VITE_DEV_SERVER_URL;
const app = await electron.launch({ executablePath: path, args: [], env, timeout: 60000 });
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  assert.equal(await app.evaluate(({ app }) => app.isPackaged), true);
  await page.getByLabel('Username', { exact: true }).fill('owner');
  await page.getByLabel('Password', { exact: true }).fill('ajith123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('Current password', { exact: true }).fill('ajith123');
  await page
    .getByLabel('New password (at least 8 characters)', { exact: true })
    .fill('packaged-test-2026');
  await page.getByLabel('Owner approval PIN (4–6 digits)', { exact: true }).fill('6543');
  await page.getByRole('button', { name: 'Save password', exact: true }).click();
  await page.locator('.app-shell').waitFor();
  const result = await page.evaluate(() => window.pos.invoke('products', {}));
  assert.equal(result.ok, true);
  assert.equal(result.data.length, 0);
  mkdirSync('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/packaged.png' });
  assert.deepEqual(errors, []);
  assert.ok(statSync(join(data, 'ajith.db')).size > 1000);
  console.log(
    `Packaged EXE passed: fresh owner, password/PIN change, native SQLite, blank production catalogue, renderer assets. Data: ${data}`,
  );
} finally {
  await app.close();
}

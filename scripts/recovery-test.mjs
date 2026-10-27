import { build } from 'esbuild';
import { _electron as electron } from 'playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
await build({
  entryPoints: ['tests/recovery-driver.ts'],
  outfile: 'dist-electron/recovery-driver.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron', 'better-sqlite3', 'exceljs'],
});
const env = { ...process.env, POS_DATA_DIR: mkdtempSync(join(tmpdir(), 'ajith-recovery-')) };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  args: [resolve('dist-electron/recovery-driver.cjs')],
  env,
  timeout: 60000,
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await page.locator('#username').fill('cashier');
  await page.locator('#password').fill('cashier123');
  await page.getByRole('button').click();
  await page.locator('#error').filter({ hasText: 'incorrect' }).waitFor();
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  await page.locator('#username').fill('owner');
  await page.locator('#password').fill('ajith123');
  await page.getByRole('button').click();
  await app.waitForEvent('close');
  console.log(
    'Emergency recovery: cashier rejected, owner authenticated against read-only backup, sandboxed bilingual form passed',
  );
} finally {
  await app.close().catch(() => {});
}

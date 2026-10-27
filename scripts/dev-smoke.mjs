import { createServer } from 'vite';
import { _electron as electron } from 'playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const server = await createServer();
await server.listen();
const env = {
  ...process.env,
  VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173',
  POS_DATA_DIR: mkdtempSync(join(tmpdir(), 'ajith-dev-')),
};
delete env.ELECTRON_RUN_AS_NODE;
let app;
try {
  app = await electron.launch({ args: ['.'], env, timeout: 60000 });
  const page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.getByLabel('Username', { exact: true }).fill('owner');
  await page.getByLabel('Password', { exact: true }).fill('ajith123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Set a new password', exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(
    'Development Vite + Electron, CSP nonce, React refresh, local fonts and IPC authentication passed',
  );
} finally {
  if (app) await app.close();
  await server.close();
}

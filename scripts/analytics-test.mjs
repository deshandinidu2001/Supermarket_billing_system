import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import electron from 'electron';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..', import.meta.url)));
if (
  !process.env.DATABASE_URL ||
  !new URL(process.env.DATABASE_URL).pathname.startsWith('/ajith_test_')
)
  throw new Error('Set DATABASE_URL to a dedicated ajith_test_* PostgreSQL database.');
const web = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
  cwd: 'apps/web',
  stdio: 'inherit',
  windowsHide: true,
});
if (web.status !== 0) process.exit(web.status ?? 1);
const fixture = join(mkdtempSync(join(tmpdir(), 'ajith-analytics-fixture-')), 'fixture.json');
await build({
  entryPoints: ['tests/cloud-integration.ts'],
  outfile: 'dist-electron/cloud-integration.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['better-sqlite3'],
});
await build({
  entryPoints: ['tests/cloud-sync-driver.ts'],
  outfile: 'dist-electron/cloud-sync-driver.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['better-sqlite3', 'electron'],
});
const env = { ...process.env, ANALYTICS_FIXTURE: fixture };
const local = spawnSync(electron, ['dist-electron/cloud-integration.cjs'], {
  stdio: 'inherit',
  env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
  windowsHide: true,
});
if (local.status !== 0) process.exit(local.status ?? 1);
const cloud = spawnSync(process.execPath, ['--import', 'tsx', '--test', 'tests/platform.test.ts'], {
  cwd: 'apps/api',
  env,
  stdio: 'inherit',
  windowsHide: true,
});
process.exit(cloud.status ?? 1);

import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import electron from 'electron';
await build({
  entryPoints: ['tests/integration.ts'],
  outfile: 'dist-electron/integration.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['better-sqlite3', 'electron', 'exceljs'],
});
const child = spawnSync(electron, ['dist-electron/integration.cjs'], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  windowsHide: true,
});
process.exit(child.status ?? 1);

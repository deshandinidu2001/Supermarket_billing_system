import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import electron from 'electron';
await build({
  entryPoints: ['tests/operations-integration.ts'],
  outfile: 'dist-electron/operations-integration.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron', 'better-sqlite3', 'exceljs'],
});
const child = spawnSync(electron, ['dist-electron/operations-integration.cjs'], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  windowsHide: true,
});
process.exit(child.status ?? 1);

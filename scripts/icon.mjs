import { spawnSync } from 'node:child_process';
import electron from 'electron';
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const result = spawnSync(electron, ['scripts/icon-electron.cjs'], {
  env,
  stdio: 'inherit',
  windowsHide: true,
});
process.exit(result.status ?? 1);

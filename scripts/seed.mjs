import { spawnSync } from 'node:child_process';
import electron from 'electron';
await import('./build-main.mjs');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawnSync(electron, ['.', '--seed'], { stdio: 'inherit', env, windowsHide: true });
process.exit(child.status ?? 1);

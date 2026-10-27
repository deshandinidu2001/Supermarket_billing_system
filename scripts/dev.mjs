import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';
await import('./build-main.mjs');
const server = await createServer();
await server.listen();
const env = { ...process.env, VITE_DEV_SERVER_URL: 'http://127.0.0.1:5173' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { stdio: 'inherit', env, windowsHide: true });
const close = () => {
  child.kill();
  server.close();
};
process.on('SIGINT', close);
process.on('SIGTERM', close);
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});

import { build } from 'esbuild';
import { mkdirSync, readdirSync, copyFileSync } from 'node:fs';
mkdirSync('dist-electron/fonts', { recursive: true });
for (const family of ['inter', 'noto-sans-sinhala']) {
  const folder = `node_modules/@fontsource/${family}/files`;
  copyFileSync(
    `node_modules/@fontsource/${family}/LICENSE`,
    `dist-electron/fonts/${family}-LICENSE.txt`,
  );
  for (const file of readdirSync(folder).filter((f) => /-(400|600)-normal\.woff2$/.test(f)))
    copyFileSync(`${folder}/${file}`, `dist-electron/fonts/${file}`);
}
await build({
  entryPoints: ['electron/main.ts'],
  outfile: 'dist-electron/main.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron', 'better-sqlite3', 'exceljs'],
  sourcemap: true,
});
await build({
  entryPoints: ['electron/preload.ts'],
  outfile: 'dist-electron/preload.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
});
await build({
  entryPoints: ['electron/recovery-preload.ts'],
  outfile: 'dist-electron/recovery-preload.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
});

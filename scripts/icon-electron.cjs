/* eslint-disable @typescript-eslint/no-require-imports -- Electron runs this icon helper as CommonJS. */
const { app, BrowserWindow } = require('electron');
const { readFileSync, writeFileSync, mkdirSync } = require('node:fs');
app
  .whenReady()
  .then(async () => {
    const win = new BrowserWindow({
      show: false,
      width: 256,
      height: 256,
      transparent: true,
      frame: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    const svg = readFileSync('public/icon.svg', 'utf8');
    await win.loadURL(
      `data:text/html,${encodeURIComponent(`<style>html,body{margin:0;width:256px;height:256px;background:transparent}svg{display:block;width:256px;height:256px}</style>${svg}`)}`,
    );
    const png = (await win.webContents.capturePage()).toPNG();
    writeFileSync('public/icon.png', png);
    const header = Buffer.alloc(22);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(1, 4);
    header.writeUInt16LE(1, 10);
    header.writeUInt16LE(32, 12);
    header.writeUInt32LE(png.length, 14);
    header.writeUInt32LE(22, 18);
    mkdirSync('build', { recursive: true });
    writeFileSync('build/icon.ico', Buffer.concat([header, png]));
    win.destroy();
    app.quit();
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });

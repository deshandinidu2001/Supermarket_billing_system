import { BrowserWindow, ipcMain } from 'electron';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { fontCss, label } from './files';
/** Authenticate against the selected, read-only backup before replacing a corrupt database. */
export async function authenticateBackupOwner(path: string): Promise<boolean> {
  const nonce = randomBytes(24).toString('base64');
  const win = new BrowserWindow({
    show: false,
    width: 540,
    height: 600,
    resizable: false,
    title: label('recoveryTitle'),
    webPreferences: {
      preload: join(__dirname, 'recovery-preload.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  const text = (key: string) => `${label(key)} / ${label(key, 'si')}`;
  win.setMenu(null);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  const credentials = z.object({
    username: z.string().trim().min(1).max(100),
    password: z.string().min(1).max(200),
  });
  let failures = 0,
    blockedUntil = 0;
  let approved = false;
  const complete = new Promise<boolean>((resolve) =>
    win.once('closed', () => {
      ipcMain.removeHandler('pos:recovery-auth');
      resolve(approved);
    }),
  );
  ipcMain.handle('pos:recovery-auth', (event, input: unknown) => {
    if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame)
      return { ok: false, error: text('forbidden') };
    if (blockedUntil > Date.now()) return { ok: false, error: text('tryLater') };
    const parsed = credentials.safeParse(input);
    if (!parsed.success) return { ok: false, error: text('validation') };
    let db: Database.Database | undefined;
    try {
      db = new Database(path, { readonly: true, fileMustExist: true });
      const owner = db
        .prepare(
          "SELECT password_hash FROM users WHERE username=? COLLATE NOCASE AND role='owner' AND active=1",
        )
        .get(parsed.data.username) as { password_hash: string } | undefined;
      if (!owner || !bcrypt.compareSync(parsed.data.password, owner.password_hash)) {
        failures++;
        if (failures >= 5) {
          blockedUntil = Date.now() + 60000;
          failures = 0;
        }
        return { ok: false, error: text('invalidCredentials') };
      }
      approved = true;
      setTimeout(() => win.close(), 100);
      return { ok: true };
    } finally {
      db?.close();
    }
  });
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; script-src 'nonce-${nonce}'; connect-src 'none'"><style>${fontCss()}*{box-sizing:border-box}body{margin:0;padding:38px;font-family:Inter,Sinhala,sans-serif;color:#1c2b30;background:#f4f6f7}h1{font-size:23px;margin:0 0 13px}p{font-size:13px;line-height:1.9;color:#67776e}form{margin-top:25px}label{display:block;font-size:12px;margin:17px 0 8px}input{display:block;width:100%;font:inherit;border:1px solid #cdd8d1;border-radius:7px;padding:12px;background:#fff}button{width:100%;border:0;border-radius:7px;padding:13px;background:#15704f;color:white;font:inherit;margin-top:23px;cursor:pointer}#error{color:#ad342d;min-height:28px;font-size:12px}</style></head><body><h1>Ajith Super Market</h1><p>${text('recoveryTitle')}<br>${text('restoreOwnerOnly')}</p><form><label for="username">${text('username')}</label><input id="username" name="username" value="owner" autocomplete="username" required><label for="password">${text('password')}</label><input id="password" name="password" type="password" autocomplete="current-password" required autofocus><button>${text('restore')}</button><p id="error" role="alert"></p></form><script nonce="${nonce}">document.querySelector('form').addEventListener('submit',async e=>{e.preventDefault();const b=document.querySelector('button');b.disabled=true;try{const r=await window.recovery.authenticate(document.querySelector('#username').value,document.querySelector('#password').value);if(!r.ok)document.querySelector('#error').textContent=r.error;}finally{b.disabled=false;}});</script></body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  win.show();
  return complete;
}

import { app, BrowserWindow, ipcMain, dialog, session, Menu } from 'electron';
import { appendFileSync, mkdirSync, existsSync, copyFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { Store } from '../db/database';
import { seed } from '../db/seed';
import { schemas, type Action, type Result } from '../shared/contracts';
import { Auth } from '../services/auth';
import { Inventory } from '../services/inventory';
import { Management } from '../services/management';
import { POS } from '../services/pos';
import { Reports } from '../services/reports';
import { AppError } from '../services/errors';
import { Backups, verifyBackup } from './backup';
import { authenticateBackupOwner } from './recovery';
import {
  customerPaymentHtml,
  exportReport,
  label,
  productFile,
  receiptHtml,
  saveOrPrint,
} from './files';
let store: Store,
  auth: Auth,
  inventory: Inventory,
  management: Management,
  pos: POS,
  reports: Reports,
  backups: Backups;
let mainWindow: BrowserWindow | null = null;
let recovering = false;
let timer: ReturnType<typeof setInterval> | undefined;
const devUrl = process.env.VITE_DEV_SERVER_URL;
app.setName('Ajith Super Market');
app.commandLine.appendSwitch('lang', 'en-GB');
const root =
  process.env.POS_DATA_DIR ||
  (app.isPackaged
    ? app.getPath('userData')
    : join(app.getPath('appData'), 'Ajith Super Market Dev'));
mkdirSync(root, { recursive: true });
app.setPath('userData', root);
const log = (error: unknown) => {
  try {
    appendFileSync(
      join(root, 'errors.log'),
      `${new Date().toISOString()} ${error instanceof Error ? error.stack : String(error)}\n`,
    );
  } catch {
    /* The original failure still reaches the UI. */
  }
};
function connect() {
  store = new Store(join(root, 'ajith.db'));
  if (store.integrity() !== 'ok') throw new AppError('integrityFailed');
  seed(store, !!devUrl || process.env.POS_DEMO === '1' || process.argv.includes('--seed'));
  auth = new Auth(store);
  inventory = new Inventory(store, auth);
  management = new Management(store, auth);
  pos = new POS(store, auth, inventory);
  reports = new Reports(store, auth);
  backups = new Backups(store, auth);
}
async function dispatch(action: Action, raw: unknown): Promise<unknown> {
  if (!['login', 'logout', 'activity', 'changePassword', 'language'].includes(action))
    auth.authorize(action);
  switch (action) {
    case 'login': {
      const d = schemas.login.parse(raw);
      return auth.login(d.username, d.password);
    }
    case 'logout':
      schemas.logout.parse(raw);
      return auth.logout();
    case 'activity':
      schemas.activity.parse(raw);
      return auth.activity();
    case 'changePassword': {
      const d = schemas.changePassword.parse(raw);
      return auth.changePassword(d.current, d.password, d.pin);
    }
    case 'language':
      return auth.language(schemas.language.parse(raw).language);
    case 'bootstrap': {
      schemas.bootstrap.parse(raw);
      const user = auth.current();
      const settings = store.settings();
      const alerts = inventory.alerts();
      return {
        user,
        settings:
          user.role === 'owner' ? settings : { ...settings, backup_folder: '', last_backup: '' },
        categories: store.all('SELECT id,name_en,name_si FROM categories ORDER BY name_en'),
        alerts:
          user.role === 'owner'
            ? alerts
            : { low: 0, expiring: 0, expired: 0, cheques: 0, backup_overdue: false },
        shift:
          store.get('SELECT * FROM shifts WHERE user_id=? AND end_time IS NULL', user.id) ?? null,
      };
    }
    case 'products': {
      const d = schemas.products.parse(raw);
      return inventory.search(d.query, d.limit, d.active);
    }
    case 'saveProduct':
      return inventory.save(schemas.saveProduct.parse(raw));
    case 'adjustStock':
      return inventory.adjust(schemas.adjustStock.parse(raw));
    case 'batches':
      return inventory.batches(schemas.batches.parse(raw).product_id);
    case 'productDetails': {
      auth.owner();
      const d = schemas.productDetails.parse(raw);
      const p = inventory.byIds([d.product_id])[0];
      if (!p) throw new AppError('notFound');
      return {
        ...p,
        barcodes: store
          .all('SELECT barcode FROM product_barcodes WHERE product_id=?', p.id)
          .map((b) => String(b.barcode)),
      };
    }
    case 'list': {
      const d = schemas.list.parse(raw);
      return management.list(d.entity, d.query);
    }
    case 'saveEntity': {
      const d = schemas.saveEntity.parse(raw);
      return management.save(d.entity, d.data);
    }
    case 'deleteEntity': {
      const d = schemas.deleteEntity.parse(raw);
      return management.delete(d.entity, d.id);
    }
    case 'purchase':
      return inventory.purchase(schemas.purchase.parse(raw));
    case 'supplierPayment':
      return management.supplierPayment(schemas.supplierPayment.parse(raw));
    case 'customerPayment':
      return management.customerPayment(schemas.customerPayment.parse(raw));
    case 'customerHistory':
      return management.history(schemas.customerHistory.parse(raw).customer_id);
    case 'saveUser':
      return auth.saveUser(schemas.saveUser.parse(raw));
    case 'loadCart':
      schemas.loadCart.parse(raw);
      return pos.loadCart();
    case 'cartProducts': {
      schemas.cartProducts.parse(raw);
      const user = auth.current();
      return inventory.byIds(pos.loadCart().lines.map((l) => l.product_id)).map((p) => {
        if (user.role === 'cashier') {
          delete p.cost_price;
          delete p.supplier_id;
        }
        return p;
      });
    }
    case 'saveCart':
      return pos.saveCart(schemas.saveCart.parse(raw));
    case 'holdCart':
      return pos.hold(schemas.holdCart.parse(raw).name);
    case 'resumeCart':
      return pos.resume(schemas.resumeCart.parse(raw).id);
    case 'deleteHeld':
      return pos.deleteHeld(schemas.deleteHeld.parse(raw).id);
    case 'checkout':
      return pos.checkout(schemas.checkout.parse(raw));
    case 'receipt':
      return pos.receipt(schemas.receipt.parse(raw).bill_no);
    case 'returnSale':
      return pos.returnSale(schemas.returnSale.parse(raw));
    case 'shift':
      return pos.shift(schemas.shift.parse(raw).action);
    case 'dashboard': {
      const d = schemas.dashboard.parse(raw);
      return reports.dashboard(d.from, d.to);
    }
    case 'report': {
      const d = schemas.report.parse(raw);
      if (d.from > d.to) throw new AppError('invalidDate');
      return reports.report(d.name, d.from, d.to);
    }
    case 'settings': {
      const user = auth.owner();
      const d = schemas.settings.parse(raw);
      const settings = { ...store.settings(), ...d };
      store.saveSettings(settings);
      store.audit(user.id, 'settings');
      return settings;
    }
    case 'backup':
      return backups.backup(schemas.backup.parse(raw).choose_folder);
    case 'restore': {
      schemas.restore.parse(raw);
      const restored = await backups.restore();
      if (restored) {
        connect();
        store.audit(null, 'restore');
      }
      return restored;
    }
    case 'export': {
      const d = schemas.export.parse(raw);
      const user = auth.owner();
      const report = reports.report(d.name, d.from, d.to);
      if (d.name === 'sales') {
        const dashboard = reports.dashboard(d.from, d.to);
        report.summary = {
          revenue: dashboard.revenue,
          cost: dashboard.cogs,
          gross_profit: dashboard.gross_profit,
          expenses: dashboard.expenses,
          net_profit: dashboard.net_profit,
          bills: dashboard.bills,
        };
      }
      return exportReport(store, report, d.from, d.to, d.format, user.language, d.print);
    }
    case 'productFile':
      return productFile(schemas.productFile.parse(raw).action, store, auth, inventory);
    case 'printReceipt': {
      const d = schemas.printReceipt.parse(raw);
      const user = auth.current();
      const receipt = pos.receipt(d.bill_no);
      return saveOrPrint(
        receiptHtml(receipt, user.language),
        receipt.sale.bill_no as string,
        d.pdf,
        user.language,
        receipt.shop.receipt_width,
      );
    }
    case 'printCustomerPayment': {
      const d = schemas.printCustomerPayment.parse(raw);
      const user = auth.owner();
      return saveOrPrint(
        customerPaymentHtml(store, d.id, user.language),
        `payment-${d.id.slice(0, 8)}`,
        d.pdf,
        user.language,
        store.settings().receipt_width,
      );
    }
    case 'integrity':
      schemas.integrity.parse(raw);
      auth.owner();
      return store.integrity();
  }
}
async function recovery(error: unknown) {
  log(error);
  const result = await dialog.showMessageBox({
    type: 'error',
    title: label('recoveryTitle'),
    message: `${label('integrityFailed')}\n\n${label('integrityFailed', 'si')}`,
    buttons: [label('close'), label('restore')],
    defaultId: 1,
    cancelId: 0,
  });
  if (result.response !== 1) return false;
  const file = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: 'SQLite backup', extensions: ['db'] }],
  });
  if (file.canceled) return false;
  verifyBackup(file.filePaths[0]);
  if (!(await authenticateBackupOwner(file.filePaths[0]))) return false;
  try {
    store?.close();
  } catch {
    /* Preserve damaged files for recovery. */
  }
  for (const suffix of ['', '-wal', '-shm']) {
    const original = join(root, `ajith.db${suffix}`);
    if (existsSync(original)) renameSync(original, `${original}.damaged-${Date.now()}`);
  }
  copyFileSync(file.filePaths[0], join(root, 'ajith.db'));
  connect();
  return true;
}
function createWindow() {
  Menu.setApplicationMenu(null);
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Ajith Super Market',
    backgroundColor: '#f4f6f7',
    show: false,
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: !app.isPackaged,
    },
  });
  const allowed = (url: string) =>
    devUrl ? url.startsWith(`${devUrl}/`) || url === devUrl : url.startsWith('file:');
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!allowed(url)) event.preventDefault();
  });
  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  if (devUrl) void mainWindow.loadURL(devUrl);
  else void mainWindow.loadFile(join(__dirname, '../dist/index.html'));
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
  app
    .whenReady()
    .then(async () => {
      try {
        connect();
      } catch (error) {
        recovering = true;
        if (!(await recovery(error))) {
          app.quit();
          return;
        }
        recovering = false;
      }
      if (process.argv.includes('--seed')) {
        console.log(`Seed complete: ${store.path}`);
        app.quit();
        return;
      }
      session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false),
      );
      session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        const url = details.url;
        callback({
          cancel: !(
            url.startsWith('file:') ||
            url.startsWith('data:') ||
            (!!devUrl &&
              (url.startsWith(`${devUrl}/`) ||
                url === devUrl ||
                url.startsWith('ws://127.0.0.1:5173/')))
          ),
        });
      });
      const actionSchema = z.enum(Object.keys(schemas) as [Action, ...Action[]]);
      ipcMain.handle(
        'pos:invoke',
        async (event, rawAction: unknown, input: unknown): Promise<Result<unknown>> => {
          try {
            if (
              !mainWindow ||
              event.sender !== mainWindow.webContents ||
              event.senderFrame !== mainWindow.webContents.mainFrame
            )
              throw new AppError('forbidden');
            const action = actionSchema.parse(rawAction);
            return { ok: true, data: await dispatch(action, input) };
          } catch (error) {
            if (error instanceof z.ZodError)
              return {
                ok: false,
                error: 'validation',
                details: error.issues.map((i) => i.path.join('.')).join(', '),
              };
            if (error instanceof AppError)
              return {
                ok: false,
                error: error.code === 'emptyCart' ? 'emptyCartError' : error.code,
                details: error.details,
              };
            log(error);
            const code = String((error as { code?: string })?.code ?? '');
            return {
              ok: false,
              error: code.includes('UNIQUE')
                ? 'duplicateRecord'
                : code.includes('FOREIGNKEY')
                  ? 'recordInUse'
                  : 'unknownError',
            };
          }
        },
      );
      createWindow();
      void backups.daily().catch(log);
      timer = setInterval(() => void backups.daily().catch(log), 60_000);
    })
    .catch((error) => {
      log(error);
      app.quit();
    });
  app.on('window-all-closed', () => {
    if (!recovering) app.quit();
  });
  app.on('before-quit', () => {
    if (timer) clearInterval(timer);
    try {
      if (store?.db.open) store.close();
    } catch (error) {
      log(error);
    }
  });
  process.on('uncaughtException', log);
  process.on('unhandledRejection', log);
}

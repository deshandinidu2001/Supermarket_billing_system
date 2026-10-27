import { _electron as electron } from 'playwright/test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
mkdirSync('test-results', { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), 'ajith-e2e-'));
const env = { ...process.env, POS_DATA_DIR: dataDir, POS_DEMO: '1' };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ['.'], env, timeout: 60000 });
let page;
const errors = [];
const network = [];
try {
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (r) => {
    if (/^https?:/.test(r.url())) network.push(r.url());
  });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1366, 768));
  await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
  await page.screenshot({ path: 'test-results/login.png' });
  await page.getByLabel('Username', { exact: true }).fill('owner');
  await page.getByLabel('Password', { exact: true }).fill('ajith123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Set a new password' }).waitFor();
  await page.getByLabel('Current password', { exact: true }).fill('ajith123');
  await page
    .getByLabel('New password (at least 8 characters)', { exact: true })
    .fill('owner-e2e-2026');
  await page.getByLabel('Owner approval PIN (4–6 digits)', { exact: true }).fill('4321');
  await page.getByRole('button', { name: 'Save password', exact: true }).click();
  await page.locator('.app-shell').waitFor();
  await page.getByRole('heading', { name: 'Overview', exact: true }).waitFor();
  await page.locator('.stat-value').first().waitFor();
  await page.screenshot({ path: 'test-results/dashboard.png', fullPage: true });
  console.log('Authentication and dashboard UI passed');
  const invoke = async (action, input = {}) => {
    const result = await page.evaluate(
      async ({ action, input }) => window.pos.invoke(action, input),
      { action, input },
    );
    assert.equal(result.ok, true, JSON.stringify(result));
    return result.data;
  };
  for (const [route, heading] of [
    ['products', 'Products & stock'],
    ['categories', 'Categories'],
    ['suppliers', 'Suppliers'],
    ['purchases', 'Purchases'],
    ['cheques', 'Cheques'],
    ['customers', 'Customers'],
    ['expenses', 'Expenses'],
    ['reports', 'Reports'],
    ['users', 'Team access'],
    ['audit', 'Activity log'],
    ['settings', 'Settings & backup'],
  ]) {
    await page.locator(`.nav-link[href="#/${route}"]`).click();
    await page.getByRole('heading', { name: heading, exact: true }).first().waitFor();
    await page.locator('.loading').waitFor({ state: 'hidden' });
    assert.equal(
      await page.locator('body').evaluate((e) => e.scrollWidth > innerWidth),
      false,
      `overflow at ${route}`,
    );
  }
  console.log('All owner routes render without horizontal overflow');
  // Exercise the real native file handlers with isolated, locally generated workbooks.
  const { default: ImportExcel } = await import('exceljs');
  const importPath = join(dataDir, 'products-import.xlsx');
  const importBook = new ImportExcel.Workbook(),
    importSheet = importBook.addWorksheet('Products');
  const headers = [
    'sku',
    'barcodes',
    'name_en',
    'name_si',
    'category_en',
    'category_si',
    'unit',
    'selling_price',
    'mrp',
    'cost_price',
    'reorder_level',
    'supplier',
    'quick_access',
    'active',
  ];
  importSheet.addRow(headers);
  importSheet.addRow([
    'IMPORT-1',
    '8880000000001',
    'Import product',
    'ආනයන භාණ්ඩය',
    'Import category',
    'ආනයන වර්ගය',
    'pcs',
    125,
    130,
    90,
    5,
    '',
    0,
    1,
  ]);
  await importBook.xlsx.writeFile(importPath);
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, importPath);
  assert.equal((await invoke('productFile', { action: 'import' })).count, 1);
  assert.equal((await invoke('products', { query: 'ආනයන' }))[0].sku, 'IMPORT-1');
  const exportedProducts = join(dataDir, 'exported-products.csv');
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, exportedProducts);
  assert.ok((await invoke('productFile', { action: 'export' })).count >= 41);
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, exportedProducts);
  assert.ok((await invoke('productFile', { action: 'import' })).count >= 41);
  const invalidPath = join(dataDir, 'invalid-import.xlsx');
  const duplicate = new ImportExcel.Workbook(),
    duplicateSheet = duplicate.addWorksheet('Products');
  duplicateSheet.addRow(headers);
  duplicateSheet.addRow([
    'ROLLBACK-1',
    '8880000000002',
    'Will roll back',
    'ආපසු හැරෙන භාණ්ඩය',
    'Rollback category',
    'ආපසු හැරෙන වර්ගය',
    'pcs',
    100,
    100,
    75,
    5,
    '',
    0,
    1,
  ]);
  duplicateSheet.addRow([
    'ROLLBACK-2',
    '8880000000001',
    'Duplicate barcode',
    'නැවත යෙදුණු කේතය',
    'Rollback category',
    'ආපසු හැරෙන වර්ගය',
    'pcs',
    100,
    100,
    75,
    5,
    '',
    0,
    1,
  ]);
  await duplicate.xlsx.writeFile(invalidPath);
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, invalidPath);
  assert.equal(
    (await page.evaluate(() => window.pos.invoke('productFile', { action: 'import' }))).ok,
    false,
  );
  assert.equal((await invoke('products', { query: 'ROLLBACK-1' })).length, 0);
  console.log(
    'Excel/CSV catalogue round-trip, Sinhala data and invalid-file transaction rollback passed',
  );
  await page.locator('.nav-link[href="#/expenses"]').click();
  await page.getByRole('button', { name: 'Add expense', exact: true }).click();
  await page.getByLabel('Amount', { exact: false }).fill('125.50');
  await page.getByLabel('Note', { exact: false }).fill('E2E store supplies');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await page.getByText('E2E store supplies', { exact: true }).waitFor();
  const expenseRow = page.getByRole('row').filter({ hasText: 'E2E store supplies' });
  await expenseRow.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.getByText('E2E store supplies', { exact: true }).waitFor({ state: 'hidden' });
  console.log('Expense CRUD and destructive confirmation passed');
  await page.locator('.nav-link[href="#/checkout"]').click();
  await page.getByRole('button', { name: 'Start shift', exact: true }).click();
  await page.getByRole('button', { name: 'Start shift', exact: true }).waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: /Nadu rice/ }).click();
  await page.getByRole('button', { name: /Red dhal/ }).click();
  await page.getByRole('button', { name: /Fresh milk/ }).click();
  await page.getByRole('button', { name: 'Add carry bag', exact: true }).click();
  await page.waitForTimeout(180);
  const payBounds = await page.getByRole('button', { name: /^Complete sale/ }).boundingBox();
  assert.ok(
    payBounds && payBounds.y + payBounds.height <= (await page.evaluate(() => innerHeight)),
    'pay button must be visible at 1366×768',
  );
  await page.screenshot({ path: 'test-results/checkout.png' });
  const openCart = await invoke('loadCart');
  assert.equal(openCart.lines.length, 3);
  await page.keyboard.press('F4');
  await page.getByRole('textbox', { name: 'Name', exact: true }).fill('E2E held bill');
  await page.getByRole('dialog').getByRole('button', { name: 'Hold bill', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal((await invoke('loadCart')).lines.length, 0);
  await page.keyboard.press('F5');
  await page.getByRole('button', { name: 'Resume', exact: true }).click();
  await page.locator('.cart-table').waitFor();
  assert.equal((await invoke('loadCart')).lines.length, 3);
  await page.reload();
  // Restarting a renderer signs out the session UI; persisted carts remain in SQLite.
  await page.getByLabel('Username', { exact: true }).fill('owner');
  await page.getByLabel('Password', { exact: true }).fill('owner-e2e-2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.locator('.app-shell').waitFor();
  await page.locator('.nav-link[href="#/checkout"]').click();
  await page.locator('.cart-table').waitFor();
  assert.equal((await invoke('loadCart')).lines.length, 3);
  await page.getByRole('button', { name: 'Split payment', exact: true }).click();
  const split = page.getByRole('dialog');
  await split.getByLabel('Amount', { exact: true }).fill('100');
  await split.getByRole('button', { name: 'Add payment', exact: true }).click();
  await split.getByLabel('Reference', { exact: true }).fill('E2E-CARD-001');
  await split.getByRole('button', { name: 'Complete sale', exact: true }).click();
  await page.getByRole('heading', { name: 'Sale completed', exact: true }).waitFor();
  const bill = (await invoke('list', { entity: 'sales' }))[0].bill_no;
  const receipt = await invoke('receipt', { bill_no: bill });
  assert.equal(receipt.payments.length, 2);
  assert.equal((await invoke('loadCart')).lines.length, 0);
  console.log(`Checkout, hold/resume, persisted cart and split payment passed: ${bill}`);
  const pdf = resolve('test-results/receipt-en.pdf');
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, pdf);
  await invoke('printReceipt', { bill_no: bill, pdf: true });
  assert.ok(statSync(pdf).size > 5000);
  const assertWidth = (path, millimetres) => {
    const box = readFileSync(path, 'latin1').match(
      /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/,
    );
    assert.ok(box, 'PDF must have a physical page size');
    assert.ok(
      Math.abs(Number(box[1]) - (millimetres / 25.4) * 72) < 1,
      `${millimetres}mm PDF width: ${box[1]}pt`,
    );
  };
  assertWidth(pdf, 80);
  await page.getByRole('button', { name: 'Close', exact: true }).last().click();
  await page.getByRole('button', { name: 'Language', exact: true }).click();
  await page.getByRole('heading', { name: 'බිල්පත්', exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.evaluate(() => document.fonts.check('14px "Noto Sans Sinhala"')), true);
  await page.screenshot({ path: 'test-results/checkout-sinhala.png' });
  const siPdf = resolve('test-results/receipt-si.pdf');
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, siPdf);
  await invoke('printReceipt', { bill_no: bill, pdf: true });
  assert.ok(statSync(siPdf).size > 5000);
  assertWidth(siPdf, 80);
  const originalSettings = (await invoke('bootstrap')).settings;
  await invoke('settings', { ...originalSettings, receipt_width: 58 });
  const smallPdf = resolve('test-results/receipt-58mm.pdf');
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, smallPdf);
  await invoke('printReceipt', { bill_no: bill, pdf: true });
  assertWidth(smallPdf, 58);
  await invoke('settings', originalSettings);
  const siXlsx = resolve('test-results/sinhala-report.xlsx');
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, siXlsx);
  await invoke('export', {
    name: 'profitProducts',
    from: '2020-01-01',
    to: '2099-12-31',
    format: 'xlsx',
  });
  const { default: ExcelJS } = await import('exceljs');
  const sinhalaBook = new ExcelJS.Workbook();
  await sinhalaBook.xlsx.readFile(siXlsx);
  assert.ok(
    sinhalaBook.worksheets[0].getSheetValues().some((row) => JSON.stringify(row).includes('නාඩු')),
  );
  await page
    .getByRole('button', { name: 'Change theme', exact: true })
    .count()
    .then(async (n) => {
      if (n) await page.getByRole('button', { name: 'Change theme', exact: true }).click();
      else await page.getByRole('button', { name: 'තේමාව වෙනස් කරන්න', exact: true }).click();
    });
  await page.screenshot({ path: 'test-results/checkout-dark.png' });
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await page.getByRole('button', { name: 'භාෂාව', exact: true }).click();
  await page.getByRole('heading', { name: 'Checkout', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Change theme', exact: true }).click();
  const xlsx = resolve('test-results/profit.xlsx');
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, xlsx);
  await invoke('export', {
    name: 'profitProducts',
    from: '2020-01-01',
    to: '2099-12-31',
    format: 'xlsx',
  });
  assert.ok(statSync(xlsx).size > 5000);
  const backupFolder = join(dataDir, 'backups');
  mkdirSync(backupFolder);
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, backupFolder);
  const backup = await invoke('backup', { choose_folder: true });
  assert.ok(statSync(backup).size > 10000);
  await invoke('saveEntity', {
    entity: 'expenses',
    data: { date: '2026-10-27', amount: 4321, note: 'Restore verification marker' },
  });
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  }, backup);
  assert.equal(await invoke('restore'), true);
  assert.equal((await page.evaluate(() => window.pos.invoke('bootstrap', {}))).ok, false);
  await page.evaluate(() => window.dispatchEvent(new Event('pos:locked')));
  await page.getByLabel('Username', { exact: true }).fill('owner');
  await page.getByLabel('Password', { exact: true }).fill('owner-e2e-2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.locator('.app-shell').waitFor();
  assert.equal(
    (await invoke('list', { entity: 'expenses' })).some(
      (row) => row.note === 'Restore verification marker',
    ),
    false,
  );
  assert.ok(readdirSync(dataDir).some((f) => f.startsWith('safety-before-restore-')));
  await page.locator('.nav-link[href="#/checkout"]').click();
  await page.getByRole('heading', { name: 'Checkout', exact: true }).waitFor();
  console.log('English/Sinhala PDF, bundled Sinhala font, theme, Excel and SQLite backup passed');
  const catalogue = await invoke('products', { limit: 200 });
  const setup = await invoke('bootstrap');
  while (catalogue.length < 50) {
    const index = catalogue.length;
    const id = await invoke('saveProduct', {
      sku: `UI-50-${index}`,
      barcodes: [`887${String(index).padStart(10, '0')}`],
      name_en: `UI performance item ${index}`,
      name_si: `පරීක්ෂණ භාණ්ඩය ${index}`,
      category_id: setup.categories[0].id,
      unit: 'pcs',
      selling_price: 10000,
      cost_price: 7500,
      mrp: null,
      reorder_level: 5,
      active: true,
      quick_access: false,
      supplier_id: null,
      image: null,
    });
    catalogue.push({ id });
  }
  await invoke('saveCart', {
    lines: catalogue.slice(0, 50).map((p) => ({ product_id: p.id, qty: 1, discount_percent: 0 })),
    customer_id: null,
    discount_type: 'percent',
    discount_value: 0,
    bag_qty: 0,
    redeem_points: 0,
  });
  await page.reload();
  await page.getByLabel('Username', { exact: true }).fill('owner');
  await page.getByLabel('Password', { exact: true }).fill('owner-e2e-2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.locator('.cart-table tbody tr').last().waitFor();
  assert.equal(await page.locator('.cart-table tbody tr').count(), 50);
  const editStarted = performance.now();
  await page.locator('.cart-table input').first().fill('2');
  await page.waitForFunction(async () => {
    const r = await window.pos.invoke('loadCart', {});
    return r.ok && r.data.lines[0].qty === 2;
  });
  assert.ok(performance.now() - editStarted < 1000, '50-line quantity update remains responsive');
  await page.screenshot({ path: 'test-results/checkout-50lines.png' });
  await page.getByRole('button', { name: 'Clear bill', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.locator('.cart-table').waitFor({ state: 'hidden' });
  console.log(
    '50-line checkout renderer, durable quantity editing and internal cart scrolling passed',
  );
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.setMinimumSize(0, 0);
    win.setSize(390, 844);
  });
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(180);
  await page.screenshot({ path: 'test-results/checkout-mobile.png', fullPage: true });
  assert.equal(
    await page.locator('body').evaluate((e) => e.scrollWidth > innerWidth),
    false,
    'mobile overflow',
  );
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1366, 768));
  await page.getByRole('button', { name: 'Lock screen', exact: true }).click();
  await page.getByLabel('Username', { exact: true }).fill('cashier');
  await page.getByLabel('Password', { exact: true }).fill('cashier123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('Current password', { exact: true }).fill('cashier123');
  await page
    .getByLabel('New password (at least 8 characters)', { exact: true })
    .fill('cashier-e2e-2026');
  await page.getByRole('button', { name: 'Save password', exact: true }).click();
  await page.locator('.app-shell').waitFor();
  assert.equal(await page.locator('.nav-link').count(), 5);
  const cashierBoot = await invoke('bootstrap');
  for (const [action, input] of [
    ['dashboard', { from: '2026-01-01', to: '2026-12-31' }],
    ['settings', cashierBoot.settings],
    [
      'saveUser',
      {
        username: 'attacker',
        display_name: 'Attacker',
        password: 'not-allowed-2026',
        active: true,
      },
    ],
    ['backup', { choose_folder: false }],
  ]) {
    const result = await page.evaluate(({ action, input }) => window.pos.invoke(action, input), {
      action,
      input,
    });
    assert.equal(result.ok, false, action);
    assert.equal(result.error, 'forbidden', action);
  }
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  const cashierProducts = await invoke('products', {});
  assert.equal('cost_price' in cashierProducts[0], false);
  assert.equal('supplier_id' in cashierProducts[0], false);
  const forbidden = await page.evaluate(() => window.pos.invoke('list', { entity: 'suppliers' }));
  assert.equal(forbidden.ok, false);
  await page.screenshot({ path: 'test-results/cashier.png' });
  assert.deepEqual(network, []);
  assert.deepEqual(errors, []);
  writeFileSync(
    'test-results/e2e.json',
    JSON.stringify(
      { passed: true, bill, pdf, siPdf, xlsx, backup, dataDir, errors, network },
      null,
      2,
    ),
  );
  console.log(
    'Cashier navigation, main-process permission checks, responsive layout and zero network requests passed',
  );
} catch (error) {
  if (page) {
    await page.screenshot({ path: 'test-results/failure.png', fullPage: true }).catch(() => {});
    console.error((await page.locator('body').innerText()).slice(0, 7000));
  }
  try {
    console.error(readFileSync(join(dataDir, 'errors.log'), 'utf8'));
  } catch {
    /* No application errors were logged. */
  }
  console.error('Renderer errors:', errors, 'Data:', dataDir);
  throw error;
} finally {
  await app.close();
}

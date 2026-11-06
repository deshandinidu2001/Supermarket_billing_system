import { _electron as electron, expect } from 'playwright/test';
import { BinaryBitmap, Code128Reader, HybridBinarizer, RGBLuminanceSource } from '@zxing/library';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

mkdirSync('test-results', { recursive: true });
const folder = mkdtempSync(join(tmpdir(), 'ajith-operations-ui-'));
const env = { ...process.env, POS_DATA_DIR: folder, POS_DEMO: '1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
const app = await electron.launch({ args: ['.'], env, timeout: 60000 });
let page;
const errors = [];
try {
  page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (error) => errors.push(error.message));
  const invoke = async (action, input = {}) => {
    const result = await page.evaluate(({ action, input }) => window.pos.invoke(action, input), {
      action,
      input,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    return result.data;
  };
  async function login(username, password) {
    await page.getByLabel('Username', { exact: true }).fill(username);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  }
  async function lock() {
    await page.getByRole('button', { name: 'Lock screen', exact: true }).click();
  }
  async function changePassword(current, password, owner = false) {
    await page.getByLabel('Current password', { exact: true }).fill(current);
    await page.getByLabel('New password (at least 8 characters)', { exact: true }).fill(password);
    if (owner)
      await page.getByLabel('Owner approval PIN (4–6 digits)', { exact: true }).fill('4321');
    await page.getByRole('button', { name: 'Save password', exact: true }).click();
    await page.locator('.app-shell').waitFor();
  }
  // Login stays English even when a previous session selected Sinhala.
  await page.evaluate(() => {
    localStorage.setItem('ajith-language', 'si');
  });
  for (const dark of [false, true]) {
    await page.evaluate((value) => localStorage.setItem('ajith-dark', String(value)), dark);
    await page.reload();
    await expect(page.locator('.signin-credit')).toHaveText('Developed by Deshan Dinidu');
    await expect(page.getByRole('button', { name: 'Language', exact: true })).toHaveCount(0);
    await expect(page.locator('.login-receipt, .default-login')).toHaveCount(0);
    assert.equal(await page.evaluate(() => /[\u0D80-\u0DFF]/.test(document.body.innerText)), false);
    assert.equal(await page.evaluate(() => document.body.innerText.includes('ajith123')), false);
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
    assert.equal(await page.evaluate(() => localStorage.getItem('ajith-language')), 'si');
    for (const [width, height] of [
      [1440, 900],
      [1024, 768],
      [390, 844],
    ]) {
      await app.evaluate(
        ({ BrowserWindow }, size) => {
          const win = BrowserWindow.getAllWindows()[0];
          win.setMinimumSize(0, 0);
          win.unmaximize();
          win.setContentSize(...size);
        },
        [width, height],
      );
      await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
      const credit = await page.locator('.signin-credit').boundingBox();
      assert.ok(credit.y + credit.height <= height, `Developer credit visible at ${width}`);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
      );
      await page.screenshot({
        path: `test-results/login-${dark ? 'dark' : 'light'}-${width}.png`,
        animations: 'disabled',
      });
    }
    await page.getByRole('button', { name: 'Cashier PIN', exact: true }).click();
    await expect(page.locator('.signin-form-shell')).toContainText('No cashier PINs are ready.');
    assert.equal(await page.evaluate(() => /[\u0D80-\u0DFF]/.test(document.body.innerText)), false);
    await page.getByRole('button', { name: 'Password', exact: true }).click();
  }
  await page.evaluate(() => localStorage.setItem('ajith-dark', 'false'));
  await page.reload();
  console.log(
    'English-only login, removed sample receipt/credentials, developer credit and responsive light/dark layout passed',
  );
  await login('owner', 'ajith123');
  await changePassword('ajith123', 'owner-ui-operations', true);
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.unmaximize();
    win.setContentSize(1366, 768);
  });
  const products = await invoke('products', { limit: 200 });
  const pcs = products.find((product) => product.unit === 'pcs' && product.available_stock > 10);

  await page.locator('.nav-link[href="#/stocktaking"]').click();
  await page.getByRole('button', { name: 'Start stock count', exact: true }).click();
  await page
    .getByRole('spinbutton', { name: `Counted stock: ${pcs.name_en}`, exact: true })
    .fill(String(pcs.stock - 2));
  await page.getByRole('button', { name: 'Save count', exact: true }).click();
  await expect.poll(async () => (await invoke('stocktakes'))[0].counted).toBe(1);
  await page.getByRole('button', { name: 'Count history', exact: true }).click();
  await page.getByRole('button', { name: 'Open count', exact: true }).first().click();
  await expect(
    page.getByRole('spinbutton', { name: `Counted stock: ${pcs.name_en}`, exact: true }),
  ).toHaveValue(String(pcs.stock - 2));
  await page.screenshot({ path: 'test-results/stocktake-review.png' });
  await page.getByRole('button', { name: 'Review and apply', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect.poll(async () => (await invoke('stocktakes'))[0].status).toBe('completed');
  await expect(
    page.getByRole('spinbutton', { name: `Counted stock: ${pcs.name_en}`, exact: true }),
  ).toBeDisabled();
  assert.equal((await invoke('products', { query: pcs.sku }))[0].stock, pcs.stock - 2);
  console.log('Saved physical stock count, review, application and persistence passed');

  const supplier = (await invoke('list', { entity: 'suppliers' }))[0];
  const batch = (await invoke('supplierReturnBatches', { supplier_id: supplier.id })).find(
    (entry) => entry.available >= 1,
  );
  await page.locator('.nav-link[href="#/supplierReturns"]').click();
  await page.getByRole('button', { name: 'New supplier return', exact: true }).click();
  let modal = page.getByRole('dialog');
  await modal.getByLabel('Supplier', { exact: true }).selectOption(supplier.id);
  await modal.getByLabel('Reason', { exact: true }).fill('Damaged package');
  await modal
    .getByRole('spinbutton', {
      name: `Return quantity: ${batch.name_en} ${batch.invoice_no}`,
      exact: true,
    })
    .fill('1');
  await modal.getByRole('button', { name: 'Record supplier return', exact: true }).click();
  await expect(
    modal.getByRole('heading', { name: 'Supplier return details', exact: true }),
  ).toBeVisible();
  await expect(modal).toContainText(batch.invoice_no);
  await page.screenshot({ path: 'test-results/supplier-return-details.png' });
  const after = (await invoke('list', { entity: 'suppliers' })).find(
    (entry) => entry.id === supplier.id,
  );
  assert.equal(after.balance, supplier.balance - batch.cost_price);
  await modal.getByRole('button', { name: 'Close', exact: true }).click();

  const expiryId = await invoke('saveProduct', {
    ...pcs,
    id: undefined,
    sku: 'UI-EXPIRY',
    barcodes: ['8899001122337'],
    name_en: 'Expiry check item',
    name_si: 'Expiry check item',
    mrp: null,
    active: true,
    quick_access: false,
    supplier_id: null,
    image: null,
  });
  await invoke('adjustStock', {
    product_id: expiryId,
    batch_id: null,
    qty: 405,
    cost_price: 10000,
    expiry_date: '2020-01-01',
    reason: 'correction',
  });
  async function checkStockColumns(total, available, expired) {
    await page.locator('.nav-link[href="#/products"]').click();
    await page
      .getByRole('textbox', { name: 'Search by barcode, English or Sinhala name', exact: true })
      .fill('UI-EXPIRY');
    const table = page.locator('.data-table');
    const row = table.locator('tbody tr').filter({ hasText: 'Expiry check item' });
    await expect(row).toHaveCount(1);
    const columns = await table.locator('thead th').allTextContents();
    for (const [column, value] of [
      ['Total stock', total],
      ['Available stock', available],
      ['Expired stock', expired],
    ])
      await expect(row.locator('td').nth(columns.indexOf(column))).toHaveText(String(value));
    return row;
  }
  const expiryRow = await checkStockColumns(405, 0, 405);
  await expiryRow.getByRole('button', { name: 'Stock batches', exact: true }).click();
  await expect(page.getByRole('dialog').getByText('Expired', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/expired-stock-batches.png', animations: 'disabled' });
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.screenshot({
    path: 'test-results/expired-stock-products.png',
    animations: 'disabled',
  });
  await page.locator('.nav-link[href="#/checkout"]').click();
  const expirySearch = page.getByRole('textbox', {
    name: 'Search items by name, SKU or barcode',
    exact: true,
  });
  await expirySearch.fill('UI-EXPIRY');
  const expiryCard = page.getByRole('button', { name: 'Add item: Expiry check item', exact: true });
  await expect(expiryCard).toBeDisabled();
  await expect(expiryCard.locator('.catalogue-stock')).toHaveText('Expired stock');
  await expect(expiryCard.locator('.catalogue-expired')).toHaveText('Expired: 405 pcs');
  await page.screenshot({
    path: 'test-results/expired-stock-checkout.png',
    animations: 'disabled',
  });
  await invoke('adjustStock', {
    product_id: expiryId,
    batch_id: null,
    qty: 10,
    cost_price: 10000,
    expiry_date: null,
    reason: 'correction',
  });
  await expirySearch.fill(pcs.sku);
  await expirySearch.fill('UI-EXPIRY');
  await expect(expiryCard).toBeEnabled();
  await expect(expiryCard.locator('.catalogue-stock')).toHaveText('Available: 10 pcs');
  await expect(expiryCard.locator('.catalogue-expired')).toHaveText('Expired: 405 pcs');
  await checkStockColumns(415, 10, 405);
  console.log('Expired-only and mixed stock quantities, batch status and checkout labels agree');

  const zeroId = await invoke('saveProduct', {
    ...pcs,
    id: undefined,
    sku: 'UI-ZERO',
    barcodes: ['8899001122336'],
    name_en: 'Unavailable test item',
    name_si: 'Unavailable test item',
    mrp: null,
    active: true,
    quick_access: false,
    supplier_id: null,
    image: null,
  });
  await page.locator('.nav-link[href="#/checkout"]').click();
  const search = page.getByRole('textbox', {
    name: 'Search items by name, SKU or barcode',
    exact: true,
  });
  await search.fill('UI-ZERO');
  await expect(
    page.getByRole('button', { name: 'Add item: Unavailable test item', exact: true }),
  ).toBeDisabled();
  await expect(page.locator('.catalogue-stock')).toContainText('Out of stock');
  await invoke('adjustStock', {
    product_id: zeroId,
    batch_id: null,
    qty: 2,
    cost_price: 10000,
    expiry_date: null,
    reason: 'correction',
  });
  await search.fill(pcs.sku);
  await search.fill('UI-ZERO');
  await expect(
    page.getByRole('button', { name: 'Add item: Unavailable test item', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Add item: Unavailable test item', exact: true }).click();
  await page
    .getByRole('button', { name: 'Increase quantity: Unavailable test item', exact: true })
    .click();
  await expect.poll(async () => (await invoke('loadCart')).lines[0].qty).toBe(2);
  await expect(
    page.getByRole('button', { name: 'Increase quantity: Unavailable test item', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Set quantity 3: Unavailable test item', exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('button', { name: 'Decrease quantity: Unavailable test item', exact: true })
    .click();
  await expect.poll(async () => (await invoke('loadCart')).lines[0].qty).toBe(1);
  await page.screenshot({ path: 'test-results/checkout-quantity-controls.png' });
  await page.locator('.quick-cash button').last().click();
  await page.locator('.pay-button').click();
  modal = page.getByRole('dialog');
  await expect(modal.getByRole('heading', { name: 'Sale completed', exact: true })).toBeVisible();
  const bill = (await invoke('list', { entity: 'sales' }))[0].bill_no;
  const barcode = modal.getByRole('img', { name: `Receipt barcode: ${bill}`, exact: true });
  await expect(barcode).toBeVisible();
  const bitmap = await barcode.evaluate(async (image) => {
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0);
    const rgba = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const gray = Array.from(
      { length: canvas.width * canvas.height },
      (_, index) => rgba[index * 4],
    );
    return { gray, width: canvas.width, height: canvas.height };
  });
  const decoded = new Code128Reader().decode(
    new BinaryBitmap(
      new HybridBinarizer(
        new RGBLuminanceSource(Uint8ClampedArray.from(bitmap.gray), bitmap.width, bitmap.height),
      ),
    ),
  );
  assert.equal(decoded.getText(), bill);
  await barcode.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/receipt-barcode.png' });
  await modal.getByRole('button', { name: 'Close', exact: true }).last().click();
  await page.locator('.nav-link[href="#/sales"]').click();
  const receiptSearch = page.getByRole('textbox', {
    name: 'Scan a receipt barcode or enter a bill number',
    exact: true,
  });
  await receiptSearch.fill(decoded.getText());
  await receiptSearch.press('Enter');
  await expect(page.getByRole('dialog').locator('.receipt-meta')).toContainText(bill);
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).last().click();
  console.log(
    'Out-of-stock indicators, quantity buttons/presets and decoded receipt barcode lookup passed',
  );

  // Prepare the cashier's password once, then configure and use a PIN through the UI.
  await lock();
  await login('cashier', 'cashier123');
  await changePassword('cashier123', 'cashier-ui-operations');
  await lock();
  await login('owner', 'owner-ui-operations');
  await page.locator('.nav-link[href="#/settings"]').click();
  const account = page
    .locator('.account-name-row')
    .filter({ has: page.getByText('Cashier', { exact: true }) });
  await account.getByRole('button', { name: 'Set cashier PIN', exact: true }).click();
  modal = page.getByRole('dialog');
  await modal.getByLabel('Cashier PIN', { exact: true }).fill('2468');
  await modal.getByRole('button', { name: 'Save changes', exact: true }).click();
  await modal.waitFor({ state: 'hidden' });
  const cashier = (await invoke('cashierAccounts'))[0];

  const backupFolder = join(folder, 'verified-backups');
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
  }, backupFolder);
  await page.getByRole('button', { name: 'Choose backup folder', exact: true }).click();
  await expect(page.locator('.backup-verification')).toContainText('Passed');
  await page.getByRole('button', { name: 'Verify latest backup', exact: true }).click();
  await expect.poll(async () => (await invoke('backupStatus')).status).toBe('passed');
  await page.screenshot({ path: 'test-results/backup-verification.png' });

  await page.locator('.nav-link[href="#/checkout"]').click();
  await search.fill(pcs.sku);
  await page.getByRole('button', { name: `Add item: ${pcs.name_en}`, exact: true }).click();
  async function switchToCashier() {
    await page.getByRole('button', { name: 'Switch cashier', exact: true }).click();
    const form = page.getByRole('dialog');
    await form.getByLabel('Cashier', { exact: true }).selectOption(cashier.id);
    await form.getByLabel('Cashier PIN', { exact: true }).fill('2468');
    await form.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.locator('.header-user small')).toHaveText('Cashier');
  }
  await switchToCashier();
  assert.equal((await invoke('loadCart')).lines.length, 0);
  await search.fill(pcs.sku);
  await page.getByRole('button', { name: `Add item: ${pcs.name_en}`, exact: true }).click();
  await page.getByRole('button', { name: `Set quantity 3: ${pcs.name_en}`, exact: true }).click();
  await expect.poll(async () => (await invoke('loadCart')).lines[0].qty).toBe(3);
  await page.screenshot({ path: 'test-results/cashier-pin-switch.png' });
  await lock();
  await login('owner', 'owner-ui-operations');
  assert.equal((await invoke('loadCart')).lines[0].qty, 1);
  await switchToCashier();
  assert.equal((await invoke('loadCart')).lines[0].qty, 3);
  await expect(page.locator('.nav-link[href="#/stocktaking"]')).toHaveCount(0);
  await lock();
  await page.getByRole('button', { name: 'Cashier PIN', exact: true }).click();
  await page.getByLabel('Cashier', { exact: true }).selectOption(cashier.id);
  await page.getByLabel('Cashier PIN', { exact: true }).fill('2468');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('.header-user small')).toHaveText('Cashier');
  assert.equal((await invoke('loadCart')).lines[0].qty, 3);
  // The account's saved language still applies after PIN authentication.
  await invoke('language', { language: 'si' });
  await page.reload();
  await expect(page.getByLabel('Username', { exact: true })).toBeVisible();
  assert.equal(await page.evaluate(() => document.documentElement.lang), 'en');
  await page.getByRole('button', { name: 'Cashier PIN', exact: true }).click();
  await page.getByLabel('Cashier', { exact: true }).selectOption(cashier.id);
  await page.getByLabel('Cashier PIN', { exact: true }).fill('2468');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.locator('.app-shell').waitFor();
  await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe('si');
  assert.deepEqual(errors, []);
  console.log(
    'Settings PIN configuration, login/switching with per-account carts, and visible backup verification passed',
  );
} catch (error) {
  if (page)
    await page
      .screenshot({ path: 'test-results/operations-failure.png', fullPage: true })
      .catch(() => {});
  throw error;
} finally {
  await app.close();
}

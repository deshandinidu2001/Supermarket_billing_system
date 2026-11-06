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

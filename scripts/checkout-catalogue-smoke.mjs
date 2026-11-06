import { _electron as electron, expect } from 'playwright/test';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

mkdirSync('test-results', { recursive: true });
const dataDir = mkdtempSync(join(tmpdir(), 'ajith-catalogue-'));
const env = { ...process.env, POS_DATA_DIR: dataDir, POS_DEMO: '1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.VITE_DEV_SERVER_URL;
const app = await electron.launch({ args: ['.'], env, timeout: 60000 });
let page;
const errors = [];
try {
  page = await app.firstWindow();
  page.setDefaultTimeout(20000);
  page.on('pageerror', (error) => errors.push(error.message));
  const invoke = async (action, input = {}) => {
    const result = await page.evaluate(({ action, input }) => window.pos.invoke(action, input), {
      action,
      input,
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    return result.data;
  };
  assert.equal(
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()),
    true,
  );
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    win.unmaximize();
    win.setSize(1440, 900);
  });
  await page.getByLabel('Username', { exact: true }).fill('owner');
  await page.getByLabel('Password', { exact: true }).fill('ajith123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('Current password', { exact: true }).fill('ajith123');
  await page
    .getByLabel('New password (at least 8 characters)', { exact: true })
    .fill('catalogue-test-2026');
  await page.getByLabel('Owner approval PIN (4–6 digits)', { exact: true }).fill('4321');
  await page.getByRole('button', { name: 'Save password', exact: true }).click();
  await page.locator('.app-shell').waitFor();
  await page.locator('.nav-link[href="#/checkout"]').click();
  await expect(page.locator('.catalogue-product')).toHaveCount(24);
  const firstPage = await page
    .locator('.catalogue-product')
    .evaluateAll((items) => items.map((item) => item.getAttribute('aria-label')));
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('.catalogue-product')).toHaveCount(16);
  const secondPage = await page
    .locator('.catalogue-product')
    .evaluateAll((items) => items.map((item) => item.getAttribute('aria-label')));
  assert.equal(new Set([...firstPage, ...secondPage]).size, 40);
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
  const bootstrap = await invoke('bootstrap');
  const category = bootstrap.categories[0];
  await page.getByRole('button', { name: category.name_en, exact: true }).click();
  const expectedCategory = await invoke('products', { category_id: category.id, limit: 200 });
  await expect(page.locator('.catalogue-product')).toHaveCount(expectedCategory.length);
  assert.ok(
    (await page.locator('.catalogue-product-category').allTextContents()).every(
      (value) => value === category.name_en,
    ),
  );
  const search = page.getByRole('textbox', {
    name: 'Search items by name, SKU or barcode',
    exact: true,
  });
  await search.fill('no-such-product-xyz');
  await expect(page.getByRole('heading', { name: 'No matching products' })).toBeVisible();
  await page.getByRole('button', { name: 'Show all products', exact: true }).click();
  await search.fill('නාඩු');
  await expect(page.locator('.catalogue-product')).toHaveCount(1);
  await expect(page.locator('.catalogue-product-name')).toHaveText('Nadu rice');
  await search.fill('');
  for (const route of ['customers', 'shift', 'users'])
    await expect(page.locator(`.nav-link[href="#/${route}"]`)).toHaveCount(0);
  await expect(page.locator('.customer-button')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Customer credit', exact: true })).toHaveCount(0);
  assert.equal((await invoke('bootstrap')).shift, null);

  for (const unit of ['pcs', 'pack']) {
    const counted = (await invoke('products', { limit: 200 })).find((item) => item.unit === unit);
    await search.fill(counted.sku);
    await page.getByRole('button', { name: `Add item: ${counted.name_en}`, exact: true }).click();
    const input = page.getByRole('spinbutton', {
      name: `Quantity ${counted.name_en}`,
      exact: true,
    });
    await input.fill('3.5');
    await expect(input).toHaveValue('1');
    await input.fill('3');
    await expect.poll(async () => (await invoke('loadCart')).lines[0].qty).toBe(3);
    await page.getByRole('button', { name: `Remove ${counted.name_en}`, exact: true }).click();
    await expect(page.locator('.cart-table tbody tr')).toHaveCount(0);
  }
  await search.fill('');
  const product = (await invoke('products', { query: 'Nadu rice' }))[0];
  const barcode = page.getByRole('textbox', {
    name: 'Scan a barcode or search products…',
    exact: true,
  });
  await barcode.fill(product.barcode);
  await page
    .locator('.scanner-input')
    .getByRole('button', { name: 'Add item', exact: true })
    .click();
  const measurement = page.getByRole('dialog');
  await expect(
    measurement.getByRole('heading', { name: 'Enter weight', exact: true }),
  ).toBeVisible();
  await measurement
    .getByRole('combobox', { name: 'Measurement unit', exact: true })
    .selectOption('g');
  await measurement.getByRole('spinbutton', { name: 'Weight', exact: true }).fill('0');
  await expect(
    measurement.getByRole('button', { name: 'Add to bill', exact: true }),
  ).toBeDisabled();
  await measurement.getByRole('spinbutton', { name: 'Weight', exact: true }).fill('0.5');
  await expect(
    measurement.getByRole('button', { name: 'Add to bill', exact: true }),
  ).toBeDisabled();
  await measurement.getByRole('button', { name: '500 g', exact: true }).click();
  await expect(measurement.locator('.measurement-price strong')).toHaveText('Rs. 115.00');
  await page.screenshot({ path: 'test-results/checkout-weight.png', animations: 'disabled' });
  await measurement.getByRole('button', { name: 'Add to bill', exact: true }).click();
  await expect(page.locator('.cart-table tbody tr')).toHaveCount(1);
  await expect(
    page.getByRole('spinbutton', { name: 'Quantity Nadu rice', exact: true }),
  ).toHaveValue('0.5');
  assert.equal((await invoke('loadCart')).lines[0].qty, 0.5);
  await expect(page.locator('.cart-table tbody tr').first()).toContainText('Rs. 115.00');
  assert.ok(
    (await page.locator('.cart-scroll').boundingBox()).height >= 80,
    'Selected items need enough visible space',
  );
  const selectedBounds = await page.locator('.cart-panel').boundingBox();
  const catalogueBounds = await page.locator('.catalogue-panel').boundingBox();
  assert.ok(
    catalogueBounds.x + catalogueBounds.width <= selectedBounds.x,
    'Catalogue must appear to the left of selected bill items',
  );
  await barcode.fill(product.sku);
  await barcode.press('Enter');
  await measurement.getByRole('button', { name: 'Cancel', exact: true }).click();
  assert.equal((await invoke('loadCart')).lines[0].qty, 0.5);
  await barcode.fill(product.sku);
  await barcode.press('Enter');
  await measurement.getByRole('button', { name: '1 kg', exact: true }).click();
  await measurement.getByRole('button', { name: 'Add to bill', exact: true }).click();
  await expect(
    page.getByRole('spinbutton', { name: 'Quantity Nadu rice', exact: true }),
  ).toHaveValue('1.5');
  await search.fill('Nadu rice');
  await page.getByRole('button', { name: 'Add item: Nadu rice', exact: true }).click();
  await measurement.getByRole('spinbutton', { name: 'Weight', exact: true }).fill('1.25');
  await expect(measurement.locator('.measurement-price strong')).toHaveText('Rs. 287.50');
  await measurement.getByRole('button', { name: 'Add to bill', exact: true }).click();
  await expect(
    page.getByRole('spinbutton', { name: 'Quantity Nadu rice', exact: true }),
  ).toHaveValue('2.75');
  await page.getByRole('button', { name: 'Edit measurement: Nadu rice', exact: true }).click();
  await expect(measurement.getByRole('spinbutton', { name: 'Weight', exact: true })).toHaveValue(
    '2.75',
  );
  await measurement.getByRole('spinbutton', { name: 'Weight', exact: true }).fill('0.25');
  await measurement
    .getByRole('combobox', { name: 'Measurement unit', exact: true })
    .selectOption('g');
  await expect(measurement.getByRole('spinbutton', { name: 'Weight', exact: true })).toHaveValue(
    '250',
  );
  await expect(measurement.locator('.measurement-price strong')).toHaveText('Rs. 57.50');
  await measurement.getByRole('button', { name: 'Update quantity', exact: true }).click();
  await expect(
    page.getByRole('spinbutton', { name: 'Quantity Nadu rice', exact: true }),
  ).toHaveValue('0.25');
  await barcode.focus();
  assert.equal(await barcode.evaluate((input) => getComputedStyle(input).outlineStyle), 'none');
  assert.equal(await barcode.evaluate((input) => getComputedStyle(input).boxShadow), 'none');
  await search.fill('rice');
  assert.equal(await search.evaluate((input) => getComputedStyle(input).outlineStyle), 'none');
  assert.equal(await search.evaluate((input) => getComputedStyle(input).boxShadow), 'none');
  await search.fill('');
  await invoke('saveProduct', {
    ...product,
    id: undefined,
    sku: 'VOLUME-TEST',
    barcodes: ['8887776665553'],
    name_en: 'Measured oil',
    name_si: 'මිනුම් තෙල්',
    unit: 'l',
    selling_price: 30000,
    cost_price: 20000,
    mrp: null,
    active: true,
    quick_access: false,
    supplier_id: null,
    image: null,
  });
  await search.fill('VOLUME-TEST');
  await page.getByRole('button', { name: 'Add item: Measured oil', exact: true }).click();
  await expect(
    measurement.getByRole('heading', { name: 'Enter volume', exact: true }),
  ).toBeVisible();
  await measurement.getByRole('button', { name: '500 ml', exact: true }).click();
  await expect(measurement.locator('.measurement-price strong')).toHaveText('Rs. 150.00');
  await measurement.getByRole('button', { name: 'Add to bill', exact: true }).click();
  await expect(
    page.getByRole('spinbutton', { name: 'Quantity Measured oil', exact: true }),
  ).toHaveValue('0.5');
  await page.getByRole('button', { name: 'Remove Measured oil', exact: true }).click();
  await page
    .getByRole('spinbutton', { name: 'Quantity Measured oil', exact: true })
    .waitFor({ state: 'hidden' });
  await search.fill('');
  console.log(
    'Catalogue, barcode/manual weighted entry, live prices, unit conversion, editing, cancel, layout order and search focus passed',
  );

  const beforeWidth = (await page.locator('.main-shell').boundingBox()).width;
  await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click();
  await expect(page.locator('#workspace-sidebar')).toBeHidden();
  assert.ok((await page.locator('.main-shell').boundingBox()).width > beforeWidth + 150);
  await page.reload();
  await page.getByLabel('Username', { exact: true }).fill('owner');
  await page.getByLabel('Password', { exact: true }).fill('catalogue-test-2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Show sidebar', exact: true })).toBeVisible();
  await expect(page.locator('#workspace-sidebar')).toBeHidden();
  await page.getByRole('button', { name: 'Show sidebar', exact: true }).click();
  await page.locator('.nav-link[href="#/products"]').click();
  await page.getByRole('button', { name: 'Add product', exact: true }).click();
  const modal = page.getByRole('dialog');
  const imageInput = modal.getByLabel('Product image', { exact: true });
  await imageInput.setInputFiles({
    name: 'broken.png',
    mimeType: 'image/png',
    buffer: Buffer.from('not an image'),
  });
  await expect(
    page.getByText('This image could not be opened. Choose another image.', { exact: true }),
  ).toBeVisible();
  const photo = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 100;
    canvas.height = 100;
    const context = canvas.getContext('2d');
    context.fillStyle = '#15704f';
    context.fillRect(10, 10, 80, 80);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await imageInput.setInputFiles({
    name: 'product.png',
    mimeType: 'image/png',
    buffer: Buffer.from(photo, 'base64'),
  });
  await expect(modal.locator('.image-preview img')).toBeVisible();
  await modal.getByLabel('English name', { exact: true }).fill('Photo test product');
  await modal.getByLabel('Sinhala name', { exact: true }).fill('රූප පරීක්ෂණ භාණ්ඩය');
  await modal.getByLabel('SKU / scale item code', { exact: true }).fill('PHOTO-TEST');
  await modal.getByLabel('Barcodes (comma separated)', { exact: true }).fill('8887776665554');
  await modal.getByLabel('Category', { exact: true }).selectOption(category.id);
  await modal.getByLabel('Selling price', { exact: true }).fill('125');
  await modal.getByLabel('Latest cost price', { exact: true }).fill('100');
  await page.screenshot({ path: 'test-results/catalogue-product-image-form.png' });
  await modal.getByRole('button', { name: 'Save changes', exact: true }).click();
  await modal.waitFor({ state: 'hidden' });
  const saved = (await invoke('products', { query: 'PHOTO-TEST' }))[0];
  assert.equal(saved.image, `data:image/png;base64,${photo}`);
  await invoke('adjustStock', {
    product_id: saved.id,
    batch_id: null,
    qty: 5,
    cost_price: 10000,
    expiry_date: null,
    reason: 'correction',
  });
  await page.locator('.nav-link[href="#/checkout"]').click();
  await search.fill('PHOTO-TEST');
  const photoProduct = page.getByRole('button', {
    name: 'Add item: Photo test product',
    exact: true,
  });
  await expect(photoProduct.locator('img')).toBeVisible();
  await photoProduct.click();
  await expect(page.locator('.cart-table .cart-product-image')).toHaveCount(1);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/catalogue-product-image.png' });
  // Confirm the photo is still present after another edit and can be removed.
  await page.locator('.nav-link[href="#/products"]').click();
  const productRow = page.locator('tr').filter({ hasText: 'Photo test product' });
  await productRow.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(modal.locator('.image-preview img')).toBeVisible();
  await modal.getByRole('button', { name: 'Remove image', exact: true }).click();
  await expect(modal.locator('.image-preview img')).toHaveCount(0);
  await modal.getByRole('button', { name: 'Save changes', exact: true }).click();
  await modal.waitFor({ state: 'hidden' });
  assert.equal((await invoke('products', { query: 'PHOTO-TEST' }))[0].image, null);
  console.log(
    'Product creation with image, invalid image handling, persistence, bill thumbnail and image removal passed',
  );

  // Checkout must succeed without a manual shift or customer selection.
  await page.locator('.nav-link[href="#/checkout"]').click();
  await expect(page.locator('.pay-button')).toBeEnabled();
  assert.equal((await invoke('bootstrap')).shift, null);
  await page.locator('.quick-cash button').last().click();
  await page.locator('.pay-button').click();
  await expect(modal.getByRole('heading', { name: 'Sale completed', exact: true })).toBeVisible();
  const lastBill = (await invoke('list', { entity: 'sales' }))[0].bill_no;
  assert.equal((await invoke('receipt', { bill_no: lastBill })).sale.customer_id, null);
  await modal.getByRole('button', { name: 'Close', exact: true }).last().click();
  await modal.waitFor({ state: 'hidden' });
  await page.locator('.nav-link[href="#/reports"]').click();
  await page.getByRole('button', { name: 'Last receipt', exact: true }).click();
  await expect(modal.locator('.receipt-meta')).toContainText(lastBill);
  await expect(modal.locator('.data-table')).toContainText('Photo test product');
  await modal.getByRole('button', { name: 'Close', exact: true }).last().click();
  await modal.waitFor({ state: 'hidden' });
  await page
    .locator('tr')
    .filter({ hasText: lastBill })
    .getByRole('button', { name: 'Bill details', exact: true })
    .click();
  await expect(modal.locator('.receipt-meta')).toContainText(lastBill);
  await page.screenshot({ path: 'test-results/report-bill-details.png' });
  await modal.getByRole('button', { name: 'Close', exact: true }).last().click();
  await modal.waitFor({ state: 'hidden' });
  await expect(page.getByRole('columnheader', { name: 'Customer', exact: true })).toHaveCount(0);
  await page.locator('.nav-link[href="#/products"]').click();
  await page
    .getByRole('button', { name: 'Remove product: Photo test product', exact: true })
    .click();
  await modal.getByRole('button', { name: 'Confirm', exact: true }).click();
  await modal.waitFor({ state: 'hidden' });
  await expect(page.locator('tr').filter({ hasText: 'Photo test product' })).toHaveCount(0);
  assert.equal((await invoke('products', { query: 'PHOTO-TEST' })).length, 0);
  assert.equal((await invoke('products', { query: 'PHOTO-TEST', active: false }))[0].active, 0);
  assert.ok(
    (await invoke('receipt', { bill_no: lastBill })).items.some(
      (item) => item.product_id === saved.id,
    ),
  );
  await page.getByRole('checkbox', { name: 'Include removed products', exact: true }).check();
  await expect(page.locator('tr').filter({ hasText: 'Photo test product' })).toHaveCount(1);
  console.log(
    'Customer-free checkout without manual shifts, report receipts and product removal with history preservation passed',
  );

  await page.locator('.nav-link[href="#/settings"]').click();
  for (const [role, name] of [
    ['Owner', 'Review Owner'],
    ['Cashier', 'Review Cashier'],
  ]) {
    const accountRow = page
      .locator('.account-name-row')
      .filter({ has: page.getByText(role, { exact: true }) });
    await accountRow.getByRole('textbox').fill(name);
    await accountRow.getByRole('button', { name: 'Save changes', exact: true }).click();
  }
  await expect(page.locator('.header-user strong')).toHaveText('Review Owner');
  assert.equal(
    (await invoke('list', { entity: 'users' })).find((user) => user.username === 'cashier')
      .display_name,
    'Review Cashier',
  );
  await page.screenshot({ path: 'test-results/settings-account-names.png' });
  const salesBeforePreview = await invoke('list', { entity: 'sales' });
  await page.locator('.nav-link[href="#/dashboard"]').click();
  await page.getByRole('button', { name: 'Mock preview', exact: true }).click();
  await expect(page.locator('.mock-overview-notice')).toBeVisible();
  await expect(
    page
      .locator('.charts-grid')
      .first()
      .locator('.recharts-bar')
      .first()
      .locator('.recharts-bar-rectangle'),
  ).toHaveCount(12);
  await page.screenshot({ path: 'test-results/overview-mock-year.png', fullPage: true });
  assert.deepEqual(await invoke('list', { entity: 'sales' }), salesBeforePreview);
  await page.getByRole('button', { name: 'Live records', exact: true }).click();
  await expect(page.locator('.mock-overview-notice')).toHaveCount(0);

  await page.locator('.nav-link[href="#/checkout"]').click();
  for (const [width, height] of [
    [1366, 768],
    [1280, 800],
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
    await expect(page.locator('.catalogue-product').first()).toBeVisible();
    if (width >= 1024) {
      const left = await page.locator('.catalogue-panel').boundingBox();
      const right = await page.locator('.cart-panel').boundingBox();
      assert.ok(left.x + left.width <= right.x, `Product/bill columns at ${width}`);
      await search.fill('Nadu rice');
      await page.getByRole('button', { name: 'Add item: Nadu rice', exact: true }).click();
      await measurement.getByRole('button', { name: '500 g', exact: true }).click();
      await measurement.getByRole('button', { name: 'Add to bill', exact: true }).click();
      await search.fill('');
      await expect(page.locator('.cart-table tbody tr')).toHaveCount(1);
      assert.ok((await page.locator('.cart-scroll').boundingBox()).height >= 80);
    }

    if (width >= 1024) {
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollHeight > innerHeight),
        false,
        `Vertical page overflow at ${width}`,
      );
      const payBounds = await page.locator('.pay-button').boundingBox();
      assert.ok(payBounds.y + payBounds.height <= height, `Complete sale visible at ${width}`);
    }
    assert.equal(
      await page.locator('body').evaluate((body) => body.scrollWidth > innerWidth),
      false,
      `Horizontal overflow at ${width}`,
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(page.locator('.catalogue-product').first()).toBeVisible();
    await page.screenshot({ path: `test-results/catalogue-${width}.png`, animations: 'disabled' });
  }
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1366, 768),
  );
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(1366);
  await page.getByRole('button', { name: 'Hide sidebar', exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/catalogue-sidebar-hidden.png' });
  await page.getByRole('button', { name: 'Show sidebar', exact: true }).click();
  await page.getByRole('button', { name: 'Change theme', exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'test-results/catalogue-dark.png', animations: 'disabled' });

  await invoke('logout');
  await page.reload();
  await page.getByLabel('Username', { exact: true }).fill('cashier');
  await page.getByLabel('Password', { exact: true }).fill('cashier123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('Current password', { exact: true }).fill('cashier123');
  await page
    .getByLabel('New password (at least 8 characters)', { exact: true })
    .fill('cashier-review-2026');
  await page.getByRole('button', { name: 'Save password', exact: true }).click();
  await expect(page.locator('.header-user strong')).toHaveText('Review Cashier');
  const cashierProduct = (await invoke('products', { query: 'Fresh milk 1l' }))[0];
  await search.fill(cashierProduct.sku);
  await page
    .getByRole('button', { name: `Add item: ${cashierProduct.name_en}`, exact: true })
    .click();
  const cashierQuantity = page.getByRole('spinbutton', {
    name: `Quantity ${cashierProduct.name_en}`,
    exact: true,
  });
  await cashierQuantity.fill('3.5');
  await expect(cashierQuantity).toHaveValue('1');
  await cashierQuantity.fill('3');
  await expect.poll(async () => (await invoke('loadCart')).lines[0].qty).toBe(3);
  await search.fill('');
  for (const [width, height] of [
    [1900, 1000],
    [1366, 768],
    [1024, 768],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size),
      [width, height],
    );
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(width);
    await expect(page.locator('.catalogue-product').first()).toBeVisible();
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollHeight > innerHeight),
      false,
      `Cashier vertical overflow at ${width}`,
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
      `Cashier horizontal overflow at ${width}`,
    );
    assert.equal(
      Math.round((await page.locator('.checkout-content').boundingBox()).width),
      Math.round((await page.locator('.main-shell').boundingBox()).width),
      `Checkout fills width at ${width}`,
    );
    const buttonBounds = await page.locator('.pay-button').boundingBox();
    assert.ok(
      buttonBounds.y + buttonBounds.height <= height,
      `Cashier payment button visible at ${width}`,
    );
    assert.ok(
      (await page.locator('.cart-scroll').boundingBox()).height >= 80,
      `Cashier selected items visible at ${width}`,
    );
    await page.screenshot({
      path: `test-results/cashier-checkout-${width}.png`,
      animations: 'disabled',
    });
  }
  assert.deepEqual(errors, []);
  console.log(
    'Maximized launch, integer pcs/pack quantities, owner/cashier names, mock Overview and cashier viewport checks passed',
  );

  assert.deepEqual(errors, []);
  console.log(
    'Persistent sidebar, responsive checkout, dark theme and renderer error checks passed',
  );
} catch (error) {
  if (page)
    await page
      .screenshot({ path: 'test-results/catalogue-failure.png', fullPage: true })
      .catch(() => {});
  throw error;
} finally {
  await app.close();
}

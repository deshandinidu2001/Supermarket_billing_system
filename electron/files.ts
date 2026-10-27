import { BrowserWindow, dialog } from 'electron';
import ExcelJS from 'exceljs';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, extname } from 'node:path';
import type { Lang, Receipt, Report, Row } from '../shared/types';
import type { Store } from '../db/database';
import type { Auth } from '../services/auth';
import type { Inventory } from '../services/inventory';
import { AppError } from '../services/errors';
import { productSchema } from '../shared/contracts';
import en from '../src/i18n/en.json';
import si from '../src/i18n/si.json';
export const label = (key: string, lang: Lang = 'en') =>
  (lang === 'si' ? si : en)[key as keyof typeof en] ?? key;
export const moneyText = (v: number) =>
  `Rs. ${(v / 100).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const escape = (v: unknown) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const monetary = new Set([
  'total',
  'amount',
  'unit_price',
  'unit_cost',
  'cost_price',
  'revenue',
  'profit',
  'gross_profit',
  'net_profit',
  'value',
  'cost',
  'balance',
  'credit_limit',
  'paid',
  'purchases',
  'line_discount',
  'bill_discount',
  'loyalty_discount',
  'discount',
  'refunds',
]);
export function formatCell(key: string, value: string | number | null, lang: Lang) {
  if (value === null) return '—';
  if (monetary.has(key)) return moneyText(Number(value));
  if (['created_at', 'updated_at', 'start_time', 'end_time', 'last_sale'].includes(key) && value)
    return new Date(value).toLocaleString('en-GB', { hour12: true });
  if (['date', 'expiry_date', 'due_date', 'received_date'].includes(key) && value)
    return String(value).split('-').reverse().join('/');
  if (['status', 'role', 'method'].includes(key)) return label(String(value), lang);
  if (key === 'note' && ['earned', 'redeemed', 'returned'].includes(String(value)))
    return label(String(value), lang);
  if (key === 'unit') return label(`units.${value}`, lang);
  if (key === 'action') return label(`audit.${value}`, lang);
  if (key === 'is_void') return label(value ? 'yes' : 'no', lang);
  return String(value);
}
export function fontCss() {
  const files = readdirSync(join(__dirname, 'fonts'));
  const font = (match: string) => {
    const file = files.find((f) => f.includes(match));
    return file ? readFileSync(join(__dirname, 'fonts', file)).toString('base64') : '';
  };
  return `@font-face{font-family:Inter;src:url(data:font/woff2;base64,${font('inter-latin-400-normal')})} @font-face{font-family:Sinhala;src:url(data:font/woff2;base64,${font('noto-sans-sinhala-sinhala-400-normal')})}`;
}
function documentHtml(body: string, width?: number) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:"><style>${fontCss()}*{box-sizing:border-box}body{font-family:Inter,Sinhala,sans-serif;color:#111;margin:0;padding:${width ? '4mm' : '14mm'};${width ? `width:${width}mm;` : ''}font-size:${width ? '11px' : '12px'}}h1{font-size:${width ? '20px' : '24px'};margin:8px 0}h2{font-size:16px}p{margin:5px 0}header{text-align:${width ? 'center' : 'left'};margin-bottom:18px}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:7px 4px;border-bottom:1px solid #ddd;overflow-wrap:anywhere}th{background:#f0f3f1}td:last-child,th:last-child{text-align:right}.totals{border-top:1px dashed #333;margin-top:10px}.row{display:flex;justify-content:space-between;gap:12px;padding:4px 0}.big{font-size:17px;font-weight:bold}.footer{text-align:center;margin-top:18px}img.logo{max-width:45mm;max-height:20mm}tr{break-inside:avoid}@page{margin:${width ? '0' : '10mm'};${width ? `size:${width}mm auto;` : ''}}</style></head><body>${body}</body></html>`;
}
export function receiptHtml(receipt: Receipt, lang: Lang) {
  const { sale, shop, payments } = receipt;
  const t = (key: string) => escape(label(key, lang));
  const grouped = new Map<string, Row>();
  for (const item of receipt.items) {
    const key = String(item.line_id);
    const existing = grouped.get(key);
    if (existing) {
      existing.qty = Number(existing.qty) + Number(item.qty);
      existing.line_total = Number(existing.line_total) + Number(item.line_total);
      existing.discount = Number(existing.discount) + Number(item.discount);
    } else grouped.set(key, { ...item });
  }
  const row = (key: string, v: unknown, big = false) =>
    `<div class="row ${big ? 'big' : ''}"><span>${t(key)}</span><span>${escape(v)}</span></div>`;
  const itemList =
    shop.receipt_width === 58
      ? `<section>${[...grouped.values()].map((item) => `<div style="border-bottom:1px solid #ddd;padding:10px 0"><strong>${escape(item[lang === 'si' ? 'name_si' : 'name_en'])}</strong><div class="row" style="font-size:10px;padding-top:5px;align-items:flex-end"><span>${escape(item.qty)} ${t(`units.${item.unit}`)} × ${escape(moneyText(Number(item.unit_price)))}</span><strong style="white-space:nowrap">${escape(moneyText(Number(item.line_total) + Number(item.discount)))}</strong></div></div>`).join('')}</section>`
      : `<table><thead><tr><th>${t('item')}</th><th>${t('quantity')}</th><th>${t('unit_price')}</th><th>${t('total')}</th></tr></thead><tbody>${[...grouped.values()].map((item) => `<tr><td>${escape(item[lang === 'si' ? 'name_si' : 'name_en'])}</td><td>${escape(item.qty)} ${t(`units.${item.unit}`)}</td><td>${escape(moneyText(Number(item.unit_price)))}</td><td>${escape(moneyText(Number(item.line_total) + Number(item.discount)))}</td></tr>`).join('')}</tbody></table>`;
  const body = `<header>${shop.logo ? `<img class="logo" src="${escape(shop.logo)}">` : ''}<h1>${escape(shop.shop_name)}</h1><p>${escape(shop.address)}</p><p>${escape(shop.phone)}</p></header>${row('bill_no', sale.bill_no)}${row('date', formatCell('created_at', sale.created_at, lang))}${row('cashier', sale.cashier)}${receipt.customer ? row('customer', receipt.customer.name) : ''}${itemList}<section class="totals">${row('subtotal', moneyText(Number(sale.subtotal)))}${row('line_discount', moneyText(Number(sale.line_discount)))}${row('bill_discount', moneyText(Number(sale.bill_discount)))}${row('loyalty_discount', moneyText(Number(sale.loyalty_discount)))}${Number(sale.bag_total) ? row('bag_total', moneyText(Number(sale.bag_total))) : ''}${Number(sale.rounding) ? row('rounding', moneyText(Number(sale.rounding))) : ''}${row('total', moneyText(Number(sale.total)), true)}${payments.map((p) => row(String(p.method), moneyText(Number(p.amount)))).join('')}${payments.some((p) => p.method === 'cash') ? row('tendered', moneyText(payments.filter((p) => p.method === 'cash').reduce((s, p) => s + Number(p.tendered), 0))) : ''}${row('change', moneyText(payments.filter((p) => p.method === 'cash').reduce((s, p) => s + Number(p.tendered) - Number(p.amount), 0)))}</section><p class="footer">${escape(lang === 'si' ? shop.footer_si : shop.footer_en)}</p>`;
  return documentHtml(body, shop.receipt_width);
}
async function htmlWindow(html: string, width = 1000) {
  const win = new BrowserWindow({
    show: false,
    width,
    height: 1000,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await win.webContents.executeJavaScript('document.fonts.ready.then(()=>true)');
  return win;
}
export async function renderPdf(html: string, path: string, width?: number) {
  const win = await htmlWindow(html, width ? Math.ceil((width * 96) / 25.4) : 1100);
  try {
    const height = (await win.webContents.executeJavaScript(
      'Math.max(document.body.scrollHeight,200)',
    )) as number;
    const data = await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      ...(width
        ? {
            pageSize: {
              width: width / 25.4,
              height: Math.min(5000 / 25.4, Math.max(80 / 25.4, (height + 4) / 96)),
            },
            margins: { top: 0, bottom: 0, left: 0, right: 0 },
          }
        : { pageSize: 'A4', landscape: true }),
    });
    writeFileSync(path, data);
  } finally {
    win.destroy();
  }
}
export async function printHtml(html: string, width?: number) {
  const win = await htmlWindow(html, width ? Math.ceil((width * 96) / 25.4) : 1100);
  let bitmap: BrowserWindow | null = null;
  try {
    let target = win;
    if (width) {
      const height = (await win.webContents.executeJavaScript(
        'Math.max(document.body.scrollHeight,200)',
      )) as number;
      win.setContentSize(Math.ceil((width * 96) / 25.4), Math.min(height, 30000));
      const capture = await win.webContents.capturePage();
      bitmap = await htmlWindow(
        documentHtml(`<img style="width:100%;display:block" src="${capture.toDataURL()}">`, width),
        Math.ceil((width * 96) / 25.4),
      );
      target = bitmap;
    }
    await new Promise<void>((resolve, reject) =>
      target.webContents.print(
        { silent: false, printBackground: true, margins: { marginType: 'none' } },
        (success, reason) =>
          success
            ? resolve()
            : reject(
                new AppError(reason.toLowerCase().includes('cancel') ? 'cancelled' : 'printFailed'),
              ),
      ),
    );
  } finally {
    bitmap?.destroy();
    win.destroy();
  }
}
export async function saveOrPrint(
  html: string,
  name: string,
  pdf: boolean,
  lang: Lang,
  width?: number,
) {
  if (!pdf) {
    try {
      await printHtml(html, width);
      return '';
    } catch (error) {
      if (error instanceof AppError && error.code === 'cancelled') return null;
      const choice = await dialog.showMessageBox({
        type: 'warning',
        message: label('printFailed', lang),
        buttons: [label('cancel', lang), label('savePdf', lang)],
        defaultId: 1,
        cancelId: 0,
      });
      if (choice.response !== 1) return null;
    }
  }
  const result = await dialog.showSaveDialog({
    title: label('savePdf', lang),
    defaultPath: `${name}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (result.canceled || !result.filePath) return null;
  await renderPdf(html, result.filePath, width);
  return result.filePath;
}
export async function exportReport(
  store: Store,
  report: Report,
  from: string,
  to: string,
  format: 'xlsx' | 'csv' | 'pdf',
  lang: Lang,
  print = false,
) {
  const settings = store.settings();
  const title = label(`report.${report.title}`, lang);
  const html = documentHtml(
    `<header><h1>${escape(settings.shop_name)}</h1><h2>${escape(title)}</h2><p>${escape(from.split('-').reverse().join('/'))} — ${escape(to.split('-').reverse().join('/'))}</p><p>${escape(label('stockAsOf', lang))}</p></header>${
      report.summary
        ? `<section style="display:flex;gap:24px;flex-wrap:wrap;margin-bottom:20px">${Object.entries(
            report.summary,
          )
            .map(
              ([key, value]) =>
                `<div><p>${escape(label(key, lang))}</p><strong>${escape(key === 'bills' ? String(value) : moneyText(value))}</strong></div>`,
            )
            .join('')}</section>`
        : ''
    }<table><thead><tr>${report.columns.map((c) => `<th>${escape(label(c, lang))}</th>`).join('')}</tr></thead><tbody>${report.rows.map((row) => `<tr>${report.columns.map((c) => `<td>${escape(formatCell(c, row[c], lang))}</td>`).join('')}</tr>`).join('')}</tbody></table>`,
  );
  if (print) {
    await printHtml(html);
    return '';
  }
  if (format === 'pdf') return saveOrPrint(html, `${report.title}-${from}`, true, lang);
  const chosen = await dialog.showSaveDialog({
    title: label('export', lang),
    defaultPath: `${report.title}-${from}.${format}`,
    filters: [{ name: format, extensions: [format] }],
  });
  if (chosen.canceled || !chosen.filePath) return null;
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet(title.slice(0, 31));
  sheet.addRow([settings.shop_name]);
  sheet.addRow([title, `${from} — ${to}`]);
  sheet.addRow(report.columns.map((c) => label(c, lang)));
  for (const row of report.rows)
    sheet.addRow(
      report.columns.map((c) =>
        monetary.has(c)
          ? Number(row[c]) / 100
          : typeof row[c] === 'number' && c !== 'is_void'
            ? row[c]
            : /^[=+@-]/.test(formatCell(c, row[c], lang))
              ? `'${formatCell(c, row[c], lang)}`
              : formatCell(c, row[c], lang),
      ),
    );
  sheet.eachRow((row, index) => {
    row.font = { name: 'Noto Sans Sinhala', size: 11, bold: index <= 3 };
    row.alignment = { vertical: 'middle', wrapText: true };
    row.height = index === 1 ? 30 : 25;
  });
  sheet.columns.forEach((col, i) => {
    col.width = 24;
    if (monetary.has(report.columns[i])) col.numFmt = '"Rs. "#,##0.00';
  });
  sheet.views = [{ state: 'frozen', ySplit: 3 }];
  if (format === 'csv')
    await book.csv.writeFile(chosen.filePath, { formatterOptions: { writeBOM: true } });
  else await book.xlsx.writeFile(chosen.filePath);
  return chosen.filePath;
}
const importColumns = [
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
export async function productFile(
  action: 'import' | 'export' | 'template',
  store: Store,
  auth: Auth,
  inventory: Inventory,
) {
  const user = auth.owner();
  const lang = user.language;
  if (action !== 'import') {
    const result = await dialog.showSaveDialog({
      title: label(action === 'template' ? 'template' : 'export', lang),
      defaultPath: action === 'template' ? 'product-import-template.xlsx' : 'products.xlsx',
      filters: [
        { name: 'Excel', extensions: ['xlsx'] },
        { name: 'CSV', extensions: ['csv'] },
      ],
    });
    if (result.canceled || !result.filePath) return { count: 0, path: null };
    const workbook = new ExcelJS.Workbook(),
      sheet = workbook.addWorksheet('Products');
    sheet.addRow(importColumns);
    const rows =
      action === 'template'
        ? [
            {
              sku: '10001',
              barcodes: '4790000000001',
              name_en: 'Nadu rice',
              name_si: 'නාඩු සහල්',
              category_en: 'Rice',
              category_si: 'සහල්',
              unit: 'kg',
              selling_price: 230,
              mrp: 230,
              cost_price: 200,
              reorder_level: 20,
              supplier: '',
              quick_access: 1,
              active: 1,
            },
          ]
        : store
            .all(
              `SELECT p.*,c.name_en category_en,c.name_si category_si,COALESCE(s.name,'') supplier,(SELECT group_concat(barcode,',') FROM product_barcodes WHERE product_id=p.id) barcodes FROM products p JOIN categories c ON c.id=p.category_id LEFT JOIN suppliers s ON s.id=p.supplier_id`,
            )
            .map((p) => ({
              ...p,
              selling_price: Number(p.selling_price) / 100,
              mrp: p.mrp == null ? '' : Number(p.mrp) / 100,
              cost_price: Number(p.cost_price) / 100,
            }));
    for (const row of rows)
      sheet.addRow(
        importColumns.map((c) => {
          const v = (row as Record<string, unknown>)[c];
          return typeof v === 'string' && /^[=+@-]/.test(v) ? `'${v}` : v;
        }),
      );
    sheet.columns.forEach((c) => {
      c.width = 24;
    });
    sheet.eachRow((r) => {
      r.font = { name: 'Noto Sans Sinhala', size: 11 };
    });
    if (extname(result.filePath).toLowerCase() === '.csv')
      await workbook.csv.writeFile(result.filePath, { formatterOptions: { writeBOM: true } });
    else await workbook.xlsx.writeFile(result.filePath);
    return { count: rows.length, path: result.filePath };
  }
  const result = await dialog.showOpenDialog({
    title: label('import', lang),
    properties: ['openFile'],
    filters: [{ name: 'Excel / CSV', extensions: ['xlsx', 'csv'] }],
  });
  if (result.canceled) return { count: 0, path: null };
  const path = result.filePaths[0];
  const book = new ExcelJS.Workbook();
  if (extname(path).toLowerCase() === '.csv') await book.csv.readFile(path);
  else await book.xlsx.readFile(path);
  const sheet = book.worksheets[0];
  if (!sheet || sheet.rowCount > 20001) throw new AppError('importError');
  const headers = (sheet.getRow(1).values as unknown[])
    .slice(1)
    .map((v) => String(v).replace(/^\uFEFF/, ''));
  if (!importColumns.every((c) => headers.includes(c)))
    throw new AppError('importError', importColumns.join(', '));
  let count = 0;
  store.db.transaction(() => {
    for (let i = 2; i <= sheet.rowCount; i++) {
      const row = sheet.getRow(i);
      if (!row.hasValues) continue;
      const raw = Object.fromEntries(headers.map((h, j) => [h, row.getCell(j + 1).text]));
      try {
        if (
          !raw.category_en?.trim() ||
          !raw.category_si?.trim() ||
          raw.selling_price === '' ||
          raw.cost_price === ''
        )
          throw new AppError('importError');
        let category = store.get('SELECT id FROM categories WHERE name_en=?', raw.category_en);
        if (!category)
          category = {
            id: store.insert('categories', { name_en: raw.category_en, name_si: raw.category_si }),
          };
        const supplier = raw.supplier
          ? store.get('SELECT id FROM suppliers WHERE name=?', raw.supplier)
          : null;
        if (raw.supplier && !supplier) throw new Error('supplier');
        const existing = store.get('SELECT id FROM products WHERE sku=?', raw.sku);
        inventory.save(
          productSchema.parse({
            id: existing ? String(existing.id) : undefined,
            sku: raw.sku,
            barcodes: raw.barcodes.split(',').map((v) => v.trim()),
            name_en: raw.name_en,
            name_si: raw.name_si,
            category_id: String(category.id),
            unit: raw.unit,
            selling_price: Math.round(Number(raw.selling_price) * 100),
            mrp: raw.mrp ? Math.round(Number(raw.mrp) * 100) : null,
            cost_price: Math.round(Number(raw.cost_price) * 100),
            reorder_level: Number(raw.reorder_level),
            supplier_id: supplier ? String(supplier.id) : null,
            active: raw.active !== '0',
            quick_access: raw.quick_access === '1',
            image: existing
              ? (store.get('SELECT image FROM products WHERE id=?', String(existing.id))?.image ??
                null)
              : null,
          }),
        );
        count++;
      } catch {
        throw new AppError('importError', `${label('row', lang)} ${i}`);
      }
    }
  })();
  return { count, path };
}
export function customerPaymentHtml(store: Store, id: string, lang: Lang) {
  const payment = store.get(
    'SELECT p.*,c.name,c.phone,c.balance,u.display_name cashier FROM customer_payments p JOIN customers c ON c.id=p.customer_id JOIN users u ON u.id=p.user_id WHERE p.id=?',
    id,
  );
  if (!payment) throw new AppError('notFound');
  const s = store.settings();
  return documentHtml(
    `<header><h1>${escape(s.shop_name)}</h1><p>${escape(s.address)}</p><h2>${escape(label('paymentReceipt', lang))}</h2></header>${['name', 'phone', 'created_at', 'cashier', 'amount', 'balance'].map((key) => `<div class="row"><span>${escape(label(key, lang))}</span><span>${escape(formatCell(key, payment[key], lang))}</span></div>`).join('')}<p>${escape(lang === 'si' ? s.footer_si : s.footer_en)}</p>`,
    s.receipt_width,
  );
}

# Ajith Super Market

A local Windows desktop billing system for a single Sri Lankan supermarket. Electron runs the database, permissions, printing and backups; React provides the English/Sinhala interface. Installed copies work without an internet connection. There are no remote APIs, remote fonts, analytics or automatic update requests.

## Run from source

Use Windows 10/11 x64 and Node.js 24 LTS with npm. Installing dependencies and building the installer initially require internet access. The installed application does not.

```powershell
npm install
npm run dev
```

The development command starts Vite on `127.0.0.1:5173` and opens Electron. Opening Vite in an ordinary browser shows the login design, but database access requires Electron. Restart `npm run dev` after changing main-process or service code; renderer changes reload automatically.

If your Windows network uses a locally trusted inspection certificate and npm reports `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, enable Node's system certificate store for that PowerShell session, then retry:

```powershell
$env:NODE_OPTIONS = '--use-system-ca'
npm install
```

Certificate validation remains enabled. The lockfile pins the tested dependencies. The Electron version is pinned to a patched release compatible with the SQLite native binary. `postinstall` rebuilds native dependencies for Electron; do not replace this with a Node-only SQLite rebuild.

## First sign-in

| Account                               | Username  | Initial password |
| ------------------------------------- | --------- | ---------------- |
| Owner                                 | `owner`   | `ajith123`       |
| Sample cashier, development/demo only | `cashier` | `cashier123`     |

Passwords must be changed on first sign-in. The owner also sets a 4–6 digit approval PIN; there is no default PIN. A new password must have at least eight characters and differ from the current password. The owner creates, disables and resets cashier accounts in **Team access**. Reset passwords require another change at sign-in. Five failed sign-in/PIN attempts trigger a one-minute cooldown.

Development automatically adds sample data to an empty store: 40 bilingual products, six categories, five suppliers, ten customers, approximately four weeks of deterministic sample sales, expenses, expiry dates and a pending cheque. A packaged installation starts with the owner account and an empty catalogue.

To explicitly seed an empty development database:

```powershell
npm run seed
```

Seeding is idempotent: existing products prevent sample insertion, and existing data is never reset. Close the app before running the seed command. To seed a separate dataset, set `POS_DATA_DIR` to a dedicated directory first. This developer environment variable also works with the packaged executable; do not point a demo at the live store folder.

## Build and install

```powershell
npm run build
npm run dist
```

The installer is generated at:

```text
release/Ajith-Super-Market-Setup-1.0.0.exe
```

The unpacked application is under `release/win-unpacked/`. The NSIS installer supports a chosen installation folder and desktop shortcut. This build is unsigned because no signing certificate was supplied. Windows may show an unknown-publisher message. Application data is kept outside the installation folder and is retained on uninstall.

The app icon is included in the repository. After changing `public/icon.svg`, run `npm run icon` to regenerate its PNG and Windows ICO versions before building.

## Everyday use

1. Start a shift in **Checkout** or **My shift**.
2. Scan a barcode as keyboard input followed by Enter, search by either product name, or tap an everyday essential. Scanning an item already in the bill increases its quantity.
3. Set quantities and discounts, optionally choose a customer, redeem points or add bags. Pieces/packs require whole quantities; weight and volume quantities support three decimal places. Every valid cart change is committed to SQLite. The saved indicator changes only after that commit succeeds.
4. Enter cash received, a card/QR/bank reference, customer credit, or an exact split of these recorded payment methods. **Complete sale** saves the sale, costs, payments and stock deductions in one transaction.
5. Print the receipt or save a PDF. Last receipt and bill-number search support reprints. **My sales** lists a cashier's own sales for the current local date. The owner's sales list covers all staff.
6. Hold bills with a name and resume them later. A held bill belongs to its user. Hold or clear the current bill before resuming another one or ending a shift.

Keyboard shortcuts: **F2** search, **F3** customer, **F4** hold, **F5** held bills, **F8** complete sale, **F10** last receipt, **Esc** dismiss search/clear bill. Dialogs keep their own keyboard focus. At 1366×768, essentials scroll horizontally to leave the payment controls visible. The POS touch controls are at least 44 px. Smaller screens stack checkout and payment vertically.

Language is remembered per user. The login screen remembers the last chosen language on the device. Theme is a device preference. Auto-lock defaults to 15 minutes; unsaved invalid form input is not committed, and saved/open bills remain recoverable after locking or restarting.

## Products, receiving and supplier accounts

Products support multiple unique barcodes, a unique SKU, bilingual names, a unit, selling/latest cost/MRP, reorder threshold, supplier, active state, a local image and an everyday-essential flag. Deactivate products to preserve their sale history. A price above MRP shows a warning.

Receive goods in **Purchases** using a supplier, unique supplier invoice number, date, quantities, costs and optional expiry dates. Each line creates a batch and stock movement. Latest product cost is updated without changing earlier sales. Supplier payments reduce outstanding purchases; pending and returned cheques do not. Clearing a cheque records its supplier payment once; cleared cheques cannot be changed or deleted.

Stock is reconciled between batch balances and the immutable stock movement history. Corrections require a reason. Select a batch when reducing stock; leave the batch blank to add a new positive correction. Expired stock cannot be sold. An expiry date is sellable through that local calendar date. Selling selects the earliest expiry first, then the earliest received date; batches without expiry follow dated batches. This is FEFO with FIFO as its tie-breaker.

Negative stock is off by default. If enabled, only the owner can sell beyond available stock; the shortage is recorded as a negative batch with the latest recorded cost. Cashiers still cannot oversell. Correct negative balances by batch as stock becomes available.

### Product import/export

Download **Import template** from Products. CSV and Excel use these stable machine-readable columns:

```text
sku,barcodes,name_en,name_si,category_en,category_si,unit,selling_price,mrp,cost_price,reorder_level,supplier,quick_access,active
```

Use rupees with up to two decimal places for imported prices; they are converted to integer cents internally. Separate additional barcodes with commas inside the cell. `unit` is `pcs`, `kg`, `g`, `l`, `ml` or `pack`. Flags are `1` or `0`. MRP and supplier may be blank; a named supplier must already exist. New bilingual categories are created as needed. Existing SKUs are updated, including their complete barcode set. Stock is entered separately through receiving/adjustment; importing a catalogue does not invent opening stock. Existing images are preserved on import. A bad row rolls back the entire file and reports its row number. Imports are limited to 20,000 product rows per file. CSV exports include a UTF-8 BOM and guard spreadsheet formula-leading text.

### Scale barcode assumptions

Default configuration is prefix `22`, five item-code digits, five value digits and three decimal places. Match the embedded item code to the product SKU or barcode. In **weight** mode, the encoded value represents kilograms; a product sold in grams receives the equivalent gram quantity. In **price** mode, the encoded value represents rupees and is converted to quantity using the current selling price. Any trailing scanner check digit is ignored by the decoder; use your scanner/scale to validate barcode checksums. Configure the format to match your scale before using it. No live weighing-scale driver is included; manual weight entry is always available.

## Returns, customer credit and points

Find the original bill, select remaining quantities and give a reason. Mark damaged items to avoid returning them to sellable stock. Cashier returns and voids require the owner's PIN, checked in the main process with rate limiting. Voids require every remaining item. Returned quantities cannot exceed the original sale allocations. A full return includes the remaining bag charge and bill-rounding difference.

Refund amounts retain the original discounts and costs; repeated fractional returns cannot refund an extra cent. Restockable returns reverse their original COGS. A damaged return leaves its cost recognised, so it reduces profit appropriately without creating usable stock. Refunds first reduce any applicable outstanding customer credit; the remainder uses the selected cash/card/bank method. Choosing credit as the refund method requires the entire refund to fit the unpaid credit portion. The application records these methods and references; it does not contact a bank, card terminal or QR payment service.

Credit requires a selected customer and sufficient credit limit. Customer collections reduce their account balance and have printable/PDF receipts. Points default to one point per Rs. 100, rounded down per bill; one point defaults to Rs. 1. Points redemption reduces sale revenue, requires a customer and cannot exceed their points or the bill value. Returns reverse earned/redeemed points in proportion to refunded value. A fully points-funded zero-value bill restores redeemed points on its full return. A return can create a negative points balance if previously earned points have already been spent; this keeps the loyalty ledger honest. Customer history includes sales, collections and points entries.

## Profit and reports

All monetary amounts are integer LKR cents; quantities have up to three decimals. `Rs. 1,250.00` is the display format. Transactions use parameterised SQLite queries, WAL, foreign keys, a busy timeout and `synchronous=FULL`.

```text
Net revenue = sale totals − returns recorded in the period
COGS = recorded sale costs − restockable returned costs
Gross profit = net revenue − COGS
Net profit = gross profit − simple dated expenses
```

Each sale allocation stores `batch_id`, `unit_price`, `unit_cost`, allocated discounts, total revenue and rounded cost. Bill and loyalty discounts are allocated without losing cents. Later purchases or price edits do not rewrite history. Supplier payments and customer collections settle balances rather than changing sales profit.

Date filters use the computer's local calendar date; set Windows to Sri Lanka time for store operation. Saved timestamps are UTC. Displayed dates are DD/MM/YYYY and times use 12-hour format. The revenue/profit chart covers 12 calendar months ending in the selected end month; other charts follow the selected date range.

The sales report is an event ledger: original sales are positive and refunds are separate negative entries dated when the return occurred. This keeps its period totals consistent with the profit dashboard. Product/category profit uses allocated merchandise revenue; bag charges and bill rounding remain at bill level and therefore explain any difference from the overall gross-profit total. Current inventory, dead stock, credit, supplier balances, cheques and reorder reports show the current position regardless of the sales date filter. Other reports follow their event date.

Every report supports Excel, CSV and locally generated PDF. Daily-summary printing includes revenue, COGS, expenses, gross/net profit and bill count with the sales ledger. Excel stores Sinhala as Unicode, requests Noto Sans Sinhala, and uses Windows font fallback when that font is not installed in Excel. UI and PDF embed local fonts directly. No expense category field exists.

## Printing and hardware

Use a Windows-installed 80 mm or 58 mm thermal printer and select the matching width in Settings. Receipts are rendered with bundled fonts, captured as a bitmap and sent through the Windows print dialog so Sinhala does not depend on the printer's built-in character set. PDF generation uses Electron `printToPDF` with the same local fonts. A failed print offers PDF fallback. Cancelled dialogs leave the completed sale intact.

Choose the paper width, margins and scaling correctly in the printer driver. A keyboard-wedge USB barcode scanner needs no driver integration in the app. The app has no drawer hardware/denomination controls. Physical scanner, scale and printer models were not available during development; run a receipt/scan/weight acceptance check on the shop's actual equipment before live billing. Keep Windows and power protection appropriate for the counter. Database commits protect completed writes; keystrokes still in transit during an abrupt power failure cannot be guaranteed.

## Database, backup and recovery

| Mode                      | Default data directory             |
| ------------------------- | ---------------------------------- |
| Development / seed        | `%APPDATA%\Ajith Super Market Dev` |
| Installed application     | `%APPDATA%\Ajith Super Market`     |
| Explicit isolated testing | `POS_DATA_DIR`                     |

The directory contains `ajith.db`, its active WAL/SHM files and `errors.log`. Keep it on a local disk. Do not share one live database over a network drive or open it in multiple independent app processes. The single-instance lock prevents ordinary duplicate launches.

1. As owner, choose a backup folder in Settings, ideally on a separate USB drive. Choosing the folder also makes a backup immediately.
2. **Back up now** uses SQLite's online backup API, validates integrity, then publishes a complete `.db` file. Automatic backup checks every minute and makes one backup per local day while the app is open. It runs without requiring the owner to stay signed in. The default retention is 14 backups; only app-generated backup filenames are removed.
3. A warning appears if there is no successful backup within three days. An absent/disconnected drive causes a logged failure and leaves the warning active; reconnect it and back up manually. There is no background service when the app is closed.
4. To restore, sign in as owner, choose a compatible `.db`, and confirm the native warning. The app checks integrity, schema compatibility and foreign keys, saves `safety-before-restore-<timestamp>.db` beside the live database, replaces the live file and signs you out. Sign in with the credentials present in the backup. Keep the safety copy until the restored data has been checked.
5. Startup runs an integrity check. If the live file cannot be opened safely, a bilingual recovery dialog offers a verified backup. Before replacement, the owner must authenticate against the selected read-only backup. Cashier credentials cannot approve recovery. Damaged files are preserved with `.damaged-<timestamp>` suffixes. Protect the Windows account and backup media as well.

Use the app's backup button instead of copying a live database file without its WAL. Backups contain the full local business dataset and password hashes; they are not encrypted. Protect the Windows account and storage media. Restore replaces the entire store snapshot, including accounts, prices and settings.

## Architecture

```text
electron/       Window, sandboxed preload, validated IPC, printing/export and backup
db/             Versioned SQL migrations, SQLite access, defaults and sample seed
services/       Authentication, inventory, purchasing, POS, returns and reporting
shared/         Domain types and Zod IPC request/response contracts
src/
  components/   shadcn-style Radix dialog/button primitives, forms and tables
  features/     Checkout, inventory, owner records, receiving, returns and reports
  i18n/         Complete English/Sinhala message dictionaries
  lib/          Typed IPC client and formatting
  store.ts      Session, product cache, theme and serialised durable cart updates
tests/          Calculation/translation unit tests and native SQLite integration checks
scripts/        Development, main build, seed, native tests and Electron UI tests
public/         Local application icon
build/          Windows installer icon
```

The renderer has `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, a content security policy and no Node/SQL access. The preload exposes only an allowlisted typed invocation bridge. The main process validates each payload with Zod, checks its sender/frame and enforces the authenticated user's role for every operation. Sensitive product costs and supplier fields are omitted from cashier responses, including receipt costs. Navigation and permissions are separate layers. HTTP/network requests are denied in the production session, new windows/navigation are blocked, and browser permission requests are denied. Development allows only its local Vite server/websocket. Passwords and PINs use bcrypt hashes.

## Checks

```powershell
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run build
npm run test:e2e
npm run test:recovery
npm run test:dev
npm run dist
npm run test:packaged
```

`npm test` covers money/profit, FEFO/FIFO, split payments, bill rounding, returns, discounts, permissions, scale decoding and translation coverage. The integration script runs under Electron's Node runtime to use the correct SQLite ABI. It creates a temporary database, tests migrations, seed/auth, receiving, cheque clearing, stock rollback, idempotent sales, immutable historic costs, refunds, credit/points, all report queries, idle locking, automatic backup retention and persisted reopening. It also benchmarks search with 20,000 additional products and a 50-line sale.

The Electron UI test uses an isolated temporary store, exercises first login, every owner route, expense CRUD, hold/resume, cart persistence after renderer reload, split checkout, bilingual PDF/Excel export, backup/restore, themes, responsive layout, cashier restrictions and zero HTTP requests. Artifacts are in `test-results/`; no test uses or resets the real store. The packaged application can additionally be smoke-tested with `node scripts/packaged-smoke.mjs` after `npm run dist`.

Observed on the development computer: native product search p95 around 7 ms across a 20,000-product catalogue; persisting and completing a 50-line bill around 10 ms. These measurements are local test results, not guarantees for every counter or USB drive.

Inter and Noto Sans Sinhala are bundled with their font licences in `dist-electron/fonts`. No deployment, bank integration, hardware certification or code-signing is implied by this repository.

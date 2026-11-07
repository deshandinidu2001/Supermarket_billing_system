# Ajith Super Market — Supermarket Billing System

An offline Windows desktop point-of-sale application built for supermarket operations in Sri Lanka. The software brings billing, inventory, purchasing, customer accounts, supplier accounts and business reporting into one English/Sinhala interface.

## What I Built

Developed the desktop interface, local database, business logic and Electron integration for an end-to-end supermarket billing workflow. The application supports daily counter operations alongside stock control, financial records, staff access and data recovery.

### Checkout and Billing

- Barcode and SKU entry, product browsing, category filters and English/Sinhala product search.
- Product images, a cart with quantity controls, and weight/volume entry with unit conversion and automatic price calculation.
- Item and bill discounts, bag charges, bill rounding and loyalty point redemption.
- Recording of cash, card, QR, bank, customer credit and split payments, including payment references.
- Held bills, saved unfinished carts, cashier shifts and sales history.
- Receipt previews, thermal printing, PDF receipts, reprints and scannable bill-number barcodes.

### Products and Inventory

- Product management with bilingual names, multiple barcodes, categories, suppliers, prices, images and reorder levels.
- Batch-based stock tracking with purchase costs, expiry dates and stock movement history.
- Separate visibility for recorded stock, sellable stock and expired stock; expired batches are excluded from sales.
- Earliest-expiry stock allocation, with first-in-first-out ordering for matching expiry dates.
- Stock adjustments with reasons, physical stocktaking with saved drafts, and reviewed count differences.
- CSV and Excel catalogue import/export with validation.

### Purchasing and Supplier Accounts

- Goods receiving against supplier invoices, with quantities, costs and optional batch expiry dates.
- Supplier balances, payments and cheque tracking.
- Supplier returns linked to purchased batches, with credits calculated from original purchase costs.

### Customers, Returns and Loyalty

- Customer records, credit limits, outstanding balances and collection receipts.
- Loyalty point earning, redemption and adjustment when sales are returned.
- Bill-based returns and voids with owner approval for cashiers.
- Refund calculations that retain original discounts and distinguish restockable items from damaged returns.

### Dashboard and Reporting

- Revenue, cost of goods sold, gross profit, expenses and net profit summaries.
- Sales and refund records, product/category profit, inventory, reorder and dead-stock reports.
- Customer credit, supplier balance and cheque reports.
- Date filters, charts, Excel/CSV/PDF exports and printable daily summaries.
- Historical sale costs retained independently of later product price or purchase cost changes.

### Staff Access and Data Protection

- Owner and cashier roles, with permissions enforced in the Electron main process.
- Password changes, cashier PIN switching, owner approval PINs, failed-attempt cooldowns and automatic locking.
- Hashed passwords and PINs, validated requests and an isolated desktop interface.
- Local SQLite storage, transactional sale completion and persistent unfinished bills.
- Manual and scheduled backups, backup verification, restore and startup recovery workflows.

### Interface and Desktop Experience

- English and Sinhala interfaces with bundled fonts and remembered language preferences.
- Light/dark themes, collapsible navigation, keyboard shortcuts and layouts that adapt to smaller windows.
- Local receipt printing and document generation.
- Windows installer packaging with Electron Builder and NSIS.

### Online Owner Analytics and Mobile Companion

- Optional background synchronization to a separate cloud database, with durable offline queues, retries and duplicate protection. Desktop billing continues without internet access.
- A read-only owner web dashboard and Expo mobile app for sales, profit, inventory, expiry alerts and reorder insights.
- Separate cloud owner accounts, authorized store selection, revocable desktop enrollment and visible data freshness.
- Supported natural-language questions about top products, profit, low stock, expiry and weekly comparisons, plus an optional server-side AI provider for broader guarded SQL queries.
- Explainable demand forecasts using moving averages and weekly patterns, evaluated chronologically, with configurable reorder preferences and insufficient-history warnings.
- Account-scoped, encrypted mobile summary caching with explicit offline timestamps and cleanup on logout.
- Reconciliation and an owner-confirmed cloud rebuild workflow after restoring the local database.

Payment methods are recorded within the application; bank, card-terminal and QR payment processing integrations are outside the implemented feature set.

## Technology Stack

| Area                   | Technologies                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------ |
| Desktop application    | Electron, Node.js, TypeScript                                                        |
| User interface         | React, TypeScript, Vite                                                              |
| Styling and components | Tailwind CSS, Radix UI, Lucide React                                                 |
| State and navigation   | Zustand, React Router                                                                |
| Forms and validation   | React Hook Form, Zod                                                                 |
| Local database         | SQLite, better-sqlite3, versioned SQL migrations                                     |
| Authentication         | bcryptjs, role-based permissions, typed Electron IPC                                 |
| Languages              | i18next, react-i18next, bundled Inter and Noto Sans Sinhala fonts                    |
| Charts                 | Recharts                                                                             |
| Exports and printing   | ExcelJS, CSV generation, Electron printing and PDF APIs                              |
| Receipt barcodes       | bwip-js, Code 128                                                                    |
| Build and packaging    | Vite, esbuild, Electron Builder, NSIS                                                |
| Quality tools          | Vitest, Playwright, ESLint, Prettier, TypeScript checks                              |
| Cloud analytics API    | Node.js, Express, TypeScript, PostgreSQL, pg                                         |
| Owner web dashboard    | React, TypeScript, Vite, Recharts                                                    |
| Owner mobile app       | React Native, Expo, Expo SecureStore                                                 |
| Optional AI queries    | Server-side provider adapter, PostgreSQL SELECT validation, restricted database role |

## Engineering Highlights

- **Offline operation:** business data and core workflows stay on the local computer.
- **Transaction-safe billing:** each completed sale saves its payments, recorded costs and stock deductions together.
- **Accurate money calculations:** monetary values use integer LKR cents, with discounts and refunds allocated consistently.
- **Expiry-aware stock control:** checkout availability is calculated from sellable batches rather than total recorded stock alone.
- **Protected application boundaries:** a typed preload bridge connects React to validated, permission-checked main-process operations.
- **Recovery-focused storage:** SQLite WAL, integrity checks and verified backups support data durability and recovery.

The repository includes calculation and translation tests, native database integration checks, and Electron UI checks covering checkout, inventory operations, permissions, exports and recovery.

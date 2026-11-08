# Verification of integrated owner analytics

Verification used temporary SQLite stores and a dedicated local `ajith_test_*` PostgreSQL database. The live shop was not enrolled, reset or uploaded. No public deployment or external AI-provider request was made.

| Check                                               | Result                                                                                                                     |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Desktop TypeScript, ESLint and production build     | Passed                                                                                                                     |
| API TypeScript check and bundled server build       | Passed                                                                                                                     |
| Mobile TypeScript and Expo dependency compatibility | Passed                                                                                                                     |
| Unit suite                                          | 27 tests passed, including dates, expiry, forecasts, grouping, quantity formatting, CSV safety and cache isolation/cleanup |
| Analytics integration suite                         | 5 tests passed, plus native SQLite fixture assertions                                                                      |
| Existing native POS integration                     | Passed                                                                                                                     |
| Existing operations integration                     | Passed                                                                                                                     |
| Existing Electron UI workflow                       | Passed, including all 13 analytics IPC commands and cashier access denial                                                  |
| Emergency backup recovery UI                        | Passed                                                                                                                     |
| Android and iOS Hermes exports                      | Passed; these are JavaScript bundles, not signed installers                                                                |
| Removed browser surface                             | Browser root returns 404; browser-origin requests and cookie authentication are rejected                                   |

The analytics suite exercises transaction rollback, offline local writes, backfill plus subsequent changes, restart persistence, duplicate delivery, event gaps, deleted records, quarantined events, staged rebuild visibility, cross-store access denial, SQL guards, chronological forecasts, encrypted Electron credentials, revocation and restore/rebuild behavior. Cloud financial totals are compared with trusted desktop reports after normal and damaged returns, stock corrections and later price/cost edits.

The integrated POS UI test signs into the local owner account and the separate cloud account, pairs a temporary store directly, waits for the uploaded projection, and exercises Overview, Sales, Inventory, Forecasts, AI analyst and Alerts. It verifies that sales with no returns expose empty detail lists rather than causing a rendering failure. Renderer status is checked for cloud password/token leakage.

The test simulates an unavailable API in the main process, verifies that desktop online panels clear, adds an item to local checkout while disconnected, reconnects analytics, and locks/reopens the POS to verify that cloud sign-in is required again. Renderer HTTP requests and renderer errors are both checked. Desktop and 390px screenshots are saved as `test-results/pos-analytics-overview.png` and `test-results/pos-analytics-small.png` and were visually reviewed. The test waits for the actual resized viewport before checking overflow.

The former browser dashboard project, its launch/build scripts, static asset serving and cookie login have been removed. The mobile app separately supports a local Expo browser preview with in-memory storage and a same-origin development proxy. The Express/PostgreSQL service remains necessary for synchronization, online analytics and the native mobile app.

## Remaining external verification

- Configure HTTPS hosting, PostgreSQL runtime credentials and a separate cloud owner account; pair the intended POS explicitly through **Analytics → Connection**.
- Supply and verify an optional AI provider for broader questions. Suggested questions work without one.
- Build/install signed native mobile packages, then verify secure storage, lifecycle behavior, login/logout, network loss and Sinhala rendering on physical Android/iOS devices.
- Configure push notifications only if required; current alerts are in-app.
- Review store-wide reorder preferences and forecast errors using the store's actual history before relying on purchase suggestions.

Production builds emit dependency annotation/chunk-size notices and complete successfully. No production deployment or physical-device performance result is claimed.

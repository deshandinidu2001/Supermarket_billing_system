# Verification of the analytics extension

Verification used temporary SQLite stores and a separate local PostgreSQL 18 cluster/database. The live store was not enrolled, migrated by a test, reset or uploaded. No public deployment or external AI-provider request was made.

| Check                                               | Result                                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Desktop TypeScript check and production build       | Passed                                                                                                       |
| API TypeScript check and bundled server build       | Passed                                                                                                       |
| Owner web TypeScript check and production build     | Passed                                                                                                       |
| Mobile TypeScript and Expo dependency compatibility | Passed                                                                                                       |
| Unit suite                                          | 26 tests passed, including report dates, expiry, forecasts, grouping, CSV safety and cache isolation/cleanup |
| Analytics integration suite                         | 4 tests passed, plus native SQLite fixture assertions                                                        |
| Existing native POS integration                     | Passed                                                                                                       |
| Existing operations integration                     | Passed                                                                                                       |
| Existing Electron UI workflow                       | Passed after updating stale navigation/shift/stock fixture assumptions                                       |
| Emergency backup recovery UI                        | Passed                                                                                                       |
| Android and iOS Hermes exports                      | Passed; these are JavaScript bundles, not signed installers                                                  |
| Bundled API smoke check                             | Database health and owner web asset serving passed                                                           |
| New application dependency audit                    | API, web and mobile installs reported zero known vulnerabilities                                             |

The analytics suite exercises transaction rollback, offline local writes, backfill plus subsequent changes, restart persistence, duplicate delivery, event gaps, deleted records, quarantined events, staged rebuild visibility, cross-store access denial, SQL guards, chronological forecasts, encrypted Electron credentials, revocation and restore/rebuild behavior. Cloud financial totals are compared with trusted desktop reports after normal and damaged returns, stock corrections and later price/cost edits.

Browser checks use synchronized synthetic fixtures, not live shop results. They cover owner sign-in, inventory, suggested questions, enrollment, alerts and layout at 1440px and 390px. Screenshots are written to `test-results/owner-web-desktop.png` and `test-results/owner-web-phone.png` and were visually reviewed.

The POS UI check still verifies zero renderer HTTP requests with cloud enrollment disabled. Background synchronization runs in the main process and was tested separately against the local API.

## Remaining external verification

- Configure real HTTPS hosting, PostgreSQL credentials and a separate cloud owner account; enroll the intended desktop explicitly.
- Supply and verify an optional AI provider for broader questions. Suggested questions work without one.
- Build/install native mobile packages using the intended Android/iOS toolchains and signing configuration, then verify secure storage, lifecycle behavior and Sinhala rendering on physical devices.
- Configure push notifications only if required; current alerts are in-app.
- Review store-wide reorder preferences and forecast errors using the store's actual history before relying on purchase suggestions.

Production builds emit dependency annotation/chunk-size notices. They complete successfully; no bundle-size or physical-device performance guarantee is made.

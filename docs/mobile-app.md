# Ajith Owner mobile app

The Expo app in `apps/mobile` includes sign-in, authorized store selection, overview, searchable sales/details, inventory, forecasts/reorder explanations, AI questions/history, actionable in-app stock/expiry alerts and reporting/language settings. It uses the same analytics API and definitions as the owner web dashboard.

## Development

```powershell
npm install --prefix apps/mobile
$env:EXPO_PUBLIC_API_URL = 'https://<your-analytics-host>'
npm run analytics:mobile
```

Use the Expo development client matching the SDK pinned in the app lockfile. Sign in with the separate cloud owner account. For a physical phone, the server address must be reachable from the phone; `localhost` refers to the phone itself. HTTP is accepted only in development builds. Public configuration contains the API address only; AI keys and database credentials stay on the server.

English/Sinhala labels are shared with the owner web app. Core navigation is bilingual; some technical forecast explanations and error messages remain in English. No translation completeness beyond the shared label dictionary is claimed.

## Verification and builds

```powershell
npm run typecheck --prefix apps/mobile
cd apps/mobile
npx expo install --check
npx expo export --platform android --output-dir build-check/android
npx expo export --platform ios --output-dir build-check/ios
```

These commands check types/dependency compatibility and generate JavaScript/Hermes bundles. They do not create an APK or signed iOS app and do not prove physical-device behavior.

`eas.json` provides preview APK and production profiles. With your own Expo account and signing configuration, use `eas build --platform android --profile preview` for an installable test APK. iOS distribution requires the corresponding Apple signing/account setup. No accounts, paid builds, app-store submissions or signing credentials are created automatically.

Before distribution, test device login/logout, secure storage, background/foreground transitions, Sinhala rendering, dates, long lists, cached-data warnings, server unavailability and account switching on actual devices. In-app alerts are implemented; push notifications are not configured.

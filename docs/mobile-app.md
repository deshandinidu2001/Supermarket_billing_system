# Ajith Owner mobile app

The native Expo companion uses the same analytics API and cloud owner account as **POS → Analytics**. It includes horizontal Overview, Sales, Inventory, Forecasts, AI analyst, Alerts and Connection tabs. There is no browser dashboard dependency or mobile web target.

## Development

```powershell
npm install --prefix apps/mobile
$env:EXPO_PUBLIC_API_URL = 'https://<your-analytics-api-host>'
npm run analytics:mobile
```

Use an Expo development client matching the locked SDK. A physical phone needs an API address reachable from that phone: its own localhost does not refer to the desktop. Production sign-in requires HTTPS; HTTP is permitted only in development. Public configuration contains the API address, never provider or database credentials.

Pair the desktop through **POS → Analytics → Connection → Connect this POS**. In the phone app, enter the same API address, sign in and choose the corresponding store. Device status and revocation are available in the Connection tab. Reporting preferences remain separate from operational product and stock data.

## Connectivity and storage

The app checks API health and reloads authorized store membership. Online-only actions, including AI questions, forecast preference updates and device revocation, are unavailable when disconnected. A limited previously viewed summary can still be displayed, marked with its saved timestamp and incomplete-list warning. It is not presented as current stock or live sales.

Owner tokens and bounded account/store-specific cache chunks use SecureStore. Logout clears the local session/cache immediately and attempts network revocation without waiting for connectivity. The Connection tab and logout remain available when reports cannot load or an account has no store.

Core labels are shared with the desktop analytics view in English/Sinhala; some returned forecast explanations remain English. Confirm Sinhala rendering on physical devices before distribution.

## Verification and native builds

```powershell
npm run typecheck --prefix apps/mobile
cd apps/mobile
npx expo install --check
npx expo export --platform android --output-dir build-check/android
npx expo export --platform ios --output-dir build-check/ios
```

Exports produce JavaScript/Hermes bundles, not APKs or signed iOS packages. With your own Expo/signing configuration, `eas.json` provides preview APK and production profiles. Verify login/logout, account switching, network loss, cached-data warnings, secure storage and lifecycle transitions on actual Android/iOS devices. Current alerts are in-app; push delivery is not configured.

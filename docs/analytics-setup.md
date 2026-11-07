# Owner analytics setup

Analytics is part of the desktop POS. Open the owner-only **Analytics** sidebar entry and use its horizontal tabs. There is no separate browser dashboard.

## API and PostgreSQL

Keep a separate PostgreSQL database for the analytics projection. The desktop SQLite store remains authoritative and works offline.

```powershell
$env:ANALYTICS_DB_PASSWORD = '<choose-a-local-database-password>'
docker compose -f compose.analytics.yml up -d
npm install --prefix apps/api
$env:DATABASE_URL = 'postgresql://ajith:<URL-encoded-password>@127.0.0.1:55432/ajith_analytics'
npm run migrate --prefix apps/api
$env:OWNER_EMAIL = '<owner-email>'
$env:OWNER_PASSWORD = '<separate-cloud-password-of-at-least-12-characters>'
$env:STORE_NAME = 'Ajith Super Market'
npm run owner --prefix apps/api
Remove-Item Env:OWNER_PASSWORD
npm run analytics:api
```

Use your own values. Existing account passwords are preserved by the provisioning command. Cloud credentials are independent of desktop passwords and approval PINs. Environment variables are supplied by your shell or process manager; the API does not automatically load `.env` files. Examples are in `apps/api/.env.example`.

Migrations require permission to create/grant the `ajith_analytics_reader` role. For production, use a migration administrator and a runtime role with DML privileges and membership in that reader role. The runtime role must have neither SUPERUSER nor BYPASSRLS.

## Pair the POS without a browser

1. Rebuild/restart the desktop after installing an updated version, then sign in as its owner.
2. Open **Analytics → Connection**.
3. Enter the analytics server address and separate cloud owner email/password. For this PC's development server, use `http://127.0.0.1:4311`.
4. Sign in and select the authorized store.
5. Choose **Connect this POS**. This sends the local sales/stock projection to the selected store. Enrollment happens directly between the main process and API.
6. Keep the POS open while pending changes upload, then use Refresh and the other horizontal tabs.

Previously paired desktops retain their device credentials and outbox. Signing into analytics does not automatically enroll a new store or replace an existing device. Disconnect an existing store before pairing this POS to another store. Sync now, rebuild, disconnect, forecast preferences and device revocation are all in the Connection tab.

An owner session exists only in main-process memory. Locking, switching accounts or closing the POS clears it and attempts server logout. Background synchronization uses its separate encrypted device credential, so it can continue while the owner analytics screen is signed out.

The desktop probes the configured API rather than trusting a network icon. When unavailable, analytics panels clear their displayed data and online actions become unavailable. Local checkout, inventory and reports continue working. A local development API can be reachable without internet; a remotely hosted API needs the corresponding network connection.

## Mobile app

Install/run `apps/mobile` using [mobile-app.md](mobile-app.md). Use the same API address and cloud owner account as the POS, and select the same store. The mobile Connection tab explains desktop setup and exposes authorized devices. The phone does not connect directly to SQLite or depend on a browser application.

## AI provider

Suggested questions use trusted server calculations without AI credentials. For broader questions, configure `AI_BASE_URL`, `AI_API_KEY` and `AI_MODEL` on the API server only. The provider must implement a chat-completions JSON API. Questions and a minimal schema description are sent, not the full synchronized dataset.

Generated SQL is parsed, restricted to the approved view and read-only database role, scoped by row security, cost checked, time limited and capped at 100 results. Provider availability must be verified separately.

## Build and deploy the API

```powershell
npm run build --prefix apps/api
npm start --prefix apps/api
```

Deploy the API bundle and its production dependencies, apply `apps/api/sql` migrations separately, and supply secrets through your hosting environment. Use HTTPS for remote POS/mobile access and restrict PostgreSQL to the backend. No browser assets or frontend deployment are required. Browser-origin requests and cookie authentication are unsupported; native clients use expiring bearer sessions.

The API binds loopback by default. Set `HOST` deliberately for your private network or hosting platform. Configure reverse proxy trust/rate limiting for that specific infrastructure. No public deployment, DNS, paid service or mobile signing account is created automatically.

## Checks

Use an isolated PostgreSQL database named `ajith_test_*`. The analytics runner refuses other names.

```powershell
$env:DATABASE_URL = 'postgresql://<test-user>:<password>@127.0.0.1:55432/ajith_test_analytics'
npm run migrate --prefix apps/api
npm run test:analytics
npm test
npm run typecheck
npm run lint
npm run test:integration
npm run test:operations
npm run test:e2e
npm run typecheck --prefix apps/api
npm run typecheck --prefix apps/mobile
```

The analytics runner builds the POS and native helpers before exercising temporary SQLite stores, the API and the actual Electron analytics screen. Do not point tests at a live store.

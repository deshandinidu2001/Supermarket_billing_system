# Local analytics services

The desktop app keeps its existing local database and can run without these services. This extension uses one authoritative desktop device per store. Remote clients can view records and change reporting preferences; they cannot change operational stock or sales.

## PostgreSQL and API

Use a separate PostgreSQL database. A Docker Compose definition is included:

```powershell
$env:ANALYTICS_DB_PASSWORD = '<choose-a-local-database-password>'
docker compose -f compose.analytics.yml up -d
npm install --prefix apps/api
npm install --prefix apps/web
$env:DATABASE_URL = 'postgresql://ajith:<URL-encoded-password>@127.0.0.1:55432/ajith_analytics'
npm run migrate --prefix apps/api
$env:OWNER_EMAIL = '<owner-email>'
$env:OWNER_PASSWORD = '<choose-a-separate-cloud-password-of-at-least-12-characters>'
$env:STORE_NAME = 'Ajith Super Market'
npm run owner --prefix apps/api
Remove-Item Env:OWNER_PASSWORD
npm run analytics:api
```

Use your own values, not the angle-bracket examples. The owner command preserves an existing account's password. Cloud passwords are independent of desktop passwords/PINs. No default cloud owner account is provided. The SQL migration needs permission to create/grant the `ajith_analytics_reader` role. For a non-superuser deployment, use a migration administrator and grant the application runtime role DML privileges on its tables plus membership in that reader role. The runtime role must not have SUPERUSER or BYPASSRLS.

`apps/api/.env.example` lists configuration. Scripts use process environment variables; they do not load `.env` files automatically. Load your environment through your process manager or set it in PowerShell.

The initial owner utility creates one store and membership. Additional owners/stores can be provisioned through the same administrator process with separate email values. Multiple-store memberships are supported in the clients and API; there is no self-service membership editor.

In another terminal:

```powershell
npm run analytics:web
```

Open `http://127.0.0.1:4310`, sign in, open Settings and create an enrollment code. In the desktop owner Settings → Cloud analytics, enter `http://127.0.0.1:4311` and that code. Enrollment is single use and expires after 10 minutes. Enrolling a replacement desktop revokes the previous device. Credentials remain in the desktop main process, encrypted with Electron safeStorage; none are exposed through status IPC.

Start desktop development with its existing command. Cloud synchronization is disabled until enrollment; migrations do not enroll a real store automatically. Sync runs while the desktop app is open, in batches of 200, with a 15-second idle polling interval and bounded retries. Successful backfill pages continue with short yielding pauses until the queue drains. Pending counts and failures appear in desktop settings.

## Tests

Use a dedicated database named `ajith_test_*`; the analytics runner refuses other database names.

```powershell
$env:DATABASE_URL = 'postgresql://<test-user>:<password>@127.0.0.1:55432/ajith_test_analytics'
npm run migrate --prefix apps/api
npm run test:analytics
npm test
npm run typecheck
npm run lint
npm run test:integration
npm run test:operations
npm run build
npm run typecheck --prefix apps/api
npm run build --prefix apps/web
```

Analytics fixtures use isolated temporary SQLite databases and a test PostgreSQL database. Tests include a real Electron worker and OS-encrypted credentials. Never point these checks at a live database. The cloud suite requires a local graphical Electron-capable environment. Web UI verification uses Playwright's installed Chromium.

## Optional broader AI questions

Suggested question types use deterministic query logic and require no AI subscription. Broader questions require `AI_BASE_URL`, `AI_API_KEY` and `AI_MODEL` on the API server. The provider must support a chat-completions JSON API. Only a schema description and the question are sent; synchronized transaction datasets are not included in prompts. Broader answers identify their period as unspecified unless the generated query supplies it. Do not interpret them as the dashboard's selected date filter.

The server parses generated SQL, allows a restricted SELECT over one approved view, changes to a read-only database role, enforces row security, limits output to 100 rows, rejects expensive plans and uses a 1.5-second SQL timeout. Suggested financial questions use trusted calculations that retain the POS's cost/refund definitions. Provider availability and credentials must be validated separately.

## HTTPS deployment

Build the web client with `npm run build --prefix apps/web`. The API serves its output directly, so production web/API can share one HTTPS origin. Set `WEB_ORIGIN` to that exact origin and `NODE_ENV=production`. Terminate TLS using your hosting/reverse proxy, restrict network access to PostgreSQL, supply secrets through the host's secret manager and back up the cloud database separately.

Build the API with `npm run build --prefix apps/api` and run its bundled server with `npm start --prefix apps/api`. Keep the API's production dependencies installed, and deploy the sibling `apps/web/dist` output with it. The bundle includes shared application source; database migrations remain in `apps/api/sql` and are applied separately before starting the service.

The server binds loopback by default. Set `HOST` deliberately when exposing it to a private network/container. Configure proxy trust and per-client rate limiting for your actual reverse proxy rather than trusting arbitrary forwarded headers. No public deployment, DNS, certificates, subscriptions or cloud accounts are created by this implementation.

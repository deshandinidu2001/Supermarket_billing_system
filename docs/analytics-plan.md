# Owner analytics implementation

The local store remains the operational source of truth. Additive SQLite triggers capture an explicit field allowlist in the same transaction as each change. No cloud operation participates in checkout.

Cloud ingestion uses an ordered, deduplicated device stream. Backfill is materialized atomically in a durable outbox and uploaded in resumable pages. A staging generation replaces the visible PostgreSQL projection only at its end marker. One active source device is permitted per store. Restores require a deliberate rebuild rather than attempting a bidirectional merge.

Build stages: sync and ingestion; owner authentication; trusted reports; web and mobile clients; question routing and guarded SQL; chronological forecast evaluation; integration and UI verification.

## Interface direction

Use grocery-green #176448, ink #17372e, white #ffffff, pale mint #eef6f1, amber #a56414 and muted text #64776e. Reuse bundled Inter and Sinhala fonts. A left-aligned store header and sync notice lead to an earnings strip, a wide sales chart and a product ledger. Keep tables dense enough for real stock decisions, with airy mobile lists and clear 48px actions. Charts and stock exceptions carry the visual emphasis; avoid decorative cards around every value.

Mobile uses the same green/white vocabulary, a compact metric grid, scrollable section navigation and explicit cached-data timestamps. No remote-write controls appear in either owner client.

## Initial assumptions

- One authoritative desktop per store; one owner can have multiple stores.
- Currency is LKR integer cents. Store timezone defaults to Asia/Colombo.
- Device enrollment requires an owner-generated, short-lived code.
- No automated orders, push provider or public deployment is included without external configuration.

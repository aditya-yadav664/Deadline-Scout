# Deadline Scout hosting

Production: https://deadline-scout.vercel.app
Vercel scope/project: aditya-f11c/deadline-scout
Supabase project: vilatfehnxbcckqnacgu

## Architecture

Dockerfile.vercel packages Node.js 24 and Chromium. CLOUD_MODE selects server/cloud.js; local development continues with SQLite through server/local.js. Supabase Postgres stores owner-scoped records in public.deadline_scout_records. RLS is enabled without browser policies. Only the backend connects using DATABASE_URL, with Supabase's public root CA and hostname verification enabled.

CloudStore applies writes under a Postgres transaction/advisory lock and commits before sending a successful HTTP response. Read-only routes use read-only snapshots without waiting for monitoring's write lock. This adapter is appropriate for the present small project; larger traffic warrants narrower per-owner transactions instead of loading the whole record set.

Supabase pg_cron job deadline-scout-monitor runs every five minutes. It uses pg_net to call /api/cron with a secret retrieved from Supabase Vault. Each track's existing interval still controls when it is due. Vercel setInterval is not used for hosted monitoring. A scheduled HTTP 200 response and successful job execution were verified.

## Verified deployment work

- Existing tracking/profile/history/Google-link/delivery records were copied over a private database connection, retaining the encryption key. Existing one-time OAuth/capture/session records were not migrated.
- Homepage, assets, health, config and authenticated account/track reads returned HTTP 200. Unauthenticated track access returned 401.
- The main migrated account returned nine registrations during verification.
- Supabase OAuth referrer was rechecked after user settings changes and points to the production origin.
- The Edge extension allowlist contains ihpkmpflcgkflicadmanehdbmgjpjpgc. Updated extensions default to the hosted backend, migrate the previous localhost default once, and clear the obsolete local session. The user must reload the extension and reconnect alerts.
- Full real-user Google sign-in and live Calendar/Task writes still require the user to complete the normal browser flow; do not claim those writes were tested by deployment checks.

## Future changes

Run relevant tests and node scripts/check.js, then deploy using the linked Vercel CLI: vercel deploy --prod --yes --scope aditya-f11c. Verify the resulting production endpoints and relevant behavior. User authorization for deployment of future website/extension changes persists. Do not make Git commits or push the user's staged work unless authorized for that operation.

Use scripts/configure-vercel.js only when production environment values actually need updating. Credentials go through CLI stdin. Preserve TOKEN_ENCRYPTION_KEY and CRON_SECRET; changing them without migrating records/Vault breaks existing encrypted data or scheduling.

Keep .env*, data/, .vercel/, and node_modules/ out of Git/source archives. Public certificate server/certs/supabase-ca.crt is intentionally included. Do not provision Render or Neon.

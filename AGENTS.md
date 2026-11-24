# Deadline Scout deployment

The user requests that future website and extension changes be published to Vercel as part of completing the change. Once production hosting is configured, run relevant checks and deploy the reviewed changes, then verify the production URL. Report failures explicitly. Do not replace a working backend with a static-only preview.

The current Node backend uses persistent SQLite, an interval scheduler, and a local Chromium process. It cannot be deployed unchanged as disposable serverless functions. The user selected Vercel hosting with Supabase Postgres/Auth. Production is hosted at https://deadline-scout.vercel.app using Dockerfile.vercel and Supabase Postgres/Auth. Supabase pg_cron invokes /api/cron every five minutes; CRON_SECRET is stored in Supabase Vault and Vercel. Preserve this setup. Do not provision Render or Neon.

Never deploy `.env`, `data/`, encryption keys, browser profiles, or user databases. Extension code can be distributed as a download; Vercel cannot update an installed Edge extension automatically. Browser store publication is separate.

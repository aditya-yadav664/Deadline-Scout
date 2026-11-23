# Deadline Scout deployment

The user requests that future website and extension changes be published to Vercel as part of completing the change. Once production hosting is configured, run relevant checks and deploy the reviewed changes, then verify the production URL. Report failures explicitly. Do not replace a working backend with a static-only preview.

The current Node backend uses persistent SQLite, an interval scheduler, and a local Chromium process. It cannot be deployed unchanged as disposable serverless functions. Hosting architecture selection is pending: Vercel frontend with a persistent backend, or migration to Supabase plus scheduled jobs.

Never deploy `.env`, `data/`, encryption keys, browser profiles, or user databases. Extension code can be distributed as a download; Vercel cannot update an installed Edge extension automatically. Browser store publication is separate.

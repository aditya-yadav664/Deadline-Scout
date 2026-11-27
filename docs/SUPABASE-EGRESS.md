# Supabase egress audit

## What was transferring data

| Path | Before | After |
| --- | --- | --- |
| Hosted API and cron | Each database-backed request selected every record, including encrypted PDFs, drafts, OAuth state and other accounts' rows. | The transaction starts empty. The server loads the exact session, validates it and loads route-specific rows for that owner. Read transactions use a consistent snapshot. The existing write lock and RLS configuration remain in place. |
| Dashboard and watchlist | The dashboard polled every 15 seconds and loaded all changes. The backend fetched entire source histories. | Visible workspace views refresh every 60 seconds and when returning to the tab. The workspace requests source history's latest observation per source and date changes for active tiles and unseen alerts. The Timeline loads 20 records at a time, with older entries available by cursor. |
| Alerts and email activity | Alert polls transferred all rows into the server and then filtered. Email activity fetched all entries before the UI showed its first three. | Browser polls load queued alerts and their exact linked records. Email activity starts at three entries and loads five per click, with a cursor ordered by timestamp and ID. Live email HTML and body text stay out of the activity page. |
| Backup Signup and files | The browser repeatedly downloaded full draft lists. Reading or saving one draft also read every stored PDF at the database layer. | The draft list and receipt poll use encrypted summaries. Opening a draft loads its full answers. Only approved referenced PDFs are read during verification or autofill, and storage quota checks read sizes and expiry times. Older drafts fall back to the full encrypted draft until next saved. |
| Scheduled checks and Google sync | An idle five-minute cron wake-up read the whole table. Enabling monitoring scanned each source twice. | Cron reads due monitored tracks, armed drafts, and due email work, then loads the related records. Armed drafts are still evaluated for changed deadlines before their original backup time. Enabling monitoring reuses its fresh verified observations. Google sync still checks linked records and only updates previously linked entries. |
| OAuth, scanning and captures | OAuth, scans and extension handoffs inherited the table preload. Scan previews could return the full extracted page. | OAuth and captures read exact keys, with expired captures cleaned up using metadata. Preview callers request dates, evidence and links. Existing full response formats remain available for older clients. |

The frontend talks to the Node API. Supabase Auth handles the Google authorization and user exchange. There is no Supabase Realtime subscription or Supabase Storage transfer in this repository. PDFs are encrypted rows in Postgres. Browser worker alarms, dashboard requests, Brevo delivery and Supabase pg_cron are separate paths. Existing extension notification and job alarms stay in place.

## Measurement and validation

- The PostgreSQL fixture seeds two accounts, historical evidence, email HTML, and encrypted PDF and draft data. One initial workspace read was approximately 1,948,097 bytes with the original full-table SQL and 8,664 bytes with scoped reads. These are JSON estimates from the fixture, not measured production bandwidth.
- The PostgreSQL test covers owner scoping, legacy draft compatibility, cursor pagination, alert acknowledgement, approved attachments, idle and due cron, and account data clearing. Set SCOUT_TEST_POSTGRES_MODULE to an installed PGlite module entry point to run it. PGlite was used only for testing and is not a project dependency.
- EGRESS_DIAGNOSTICS=true enables per-request counts, approximate JSON bytes read, and response bytes on the cloud server. The diagnostics label known routes and group other routes under "other". They omit request IDs, credentials, and record contents.

## Remaining transfer

Full drafts and approved PDF handoffs still need their contents. The owner-scoped assistant and heatmap read the history needed to answer questions and display date activity. Explicit legacy history endpoints still allow a full owner-scoped read. Source pages and Google APIs are external traffic rather than Supabase egress. A production comparison should use Supabase per-service egress across comparable traffic windows after deployment. For larger datasets, check Postgres execution plans for the due-work and cursor queries before adding indexes.

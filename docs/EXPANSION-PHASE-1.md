# Deadline Scout expansion · Phase 1 foundation

## Dashboard

The dashboard opens on Overview with upcoming milestones and recent date changes from the current account or local watchlist. The collapsible navigation links to Overview, My Watchlist, Timeline, Backup Signup and the existing profile settings. The scan launcher remains accessible across dashboard views.

Select an opportunity title in Overview or My Watchlist to see its milestones, source observations and date-change history. Saved detail links use the existing track ID. Backup Signup continues to use the same track ID and editor.

## Storage and compatibility

- `GET /api/opportunities/:id` requires a full account session. Missing and other-account track IDs both return 404.
- The endpoint projects the existing track, milestone and date-change records. It exposes versioned date changes without changing the legacy API or alert payloads.
- The additive `sourceHistory` record uses `(owner, kind, trackId)` in the existing SQLite and Postgres record tables. Each source stores its latest check time and up to four distinct evidence states. Ordinary checks that find identical evidence update the check time without creating a duplicate state. Unavailable sources have an explicit status. Manual-only reminders do not fetch sources.
- The data migration is automatic on the first monitored check of each existing track. The record-table schema already supports the new kind in both stores, so this release needs no SQL migration, backfill or production schema write. Older tracks show their approved URLs immediately and fill in history as checks run. Both track removal and account clearing remove the associated observations.
- Hosted app and extension packages use separate release paths. Phase 1 changes website assets and the backend. The manifest, popup, worker and Backup Signup implementation need no new browser permissions or packaged extension update for this phase.

## Verification

Run `node --test` and `node scripts/check.js`. The opportunity tests cover compatibility with tracks that have never been checked, evidence deduplication, changed and unavailable sources, owner isolation, track deletion, and mobile dashboard navigation to Backup Signup.

Phase 2 adds meaningful non-date changes, richer verification, retained page comparisons, summaries and risk. Those features will reuse the stable track IDs, dashboard shell and source contracts introduced here.

# Deadline Scout · Project Guide for AI Contributors

This document is the orientation guide for an AI or developer continuing work on Deadline Scout. Read it together with the relevant code and `AGENTS.md`; code is authoritative when a description here and implementation disagree. The product has a live user and real data, so preserve existing behavior unless a requested change intentionally replaces it.

## What we are building

Deadline Scout is a website plus a Manifest V3 browser extension for Microsoft Edge (the user's current test browser) and Chrome. It monitors public event, application, registration, and other schedule pages; extracts contextual milestones; lets the user review and track selected dates; detects changes; and surfaces useful alerts. It can sync explicitly linked milestones to Google Calendar or Google Tasks and send opted-in transactional email through Brevo.

The product also has a Backup Signup flow. A user can capture form field descriptions and answers across pages, review and save a draft, then use the extension to restore those answers. For ordinary third-party sites, immediate background fill-and-submit is a best-effort, user-approved browser automation. The Edge browser and extension must stay running, site access must be granted, and the organizer may still require user action. The built-in demo organizer is a separate controlled integration. Never describe a click as a confirmed registration: only organizer evidence such as a recognized confirmation and receipt can establish confirmation.

This is a rule-based extractor, not a model that trains itself from browsing. An optional Gemini adapter can suggest milestone extraction from fetched text; the user reviews the result and deterministic code handles comparisons. Do not claim automatic learning or universal site compatibility.

## Current production shape

- Website and Node.js backend: `https://deadline-scout.vercel.app`.
- Hosting: Vercel Docker deployment using `Dockerfile.vercel`, not static-only/serverless page output.
- Identity: Supabase Auth with Google sign-in. The backend verifies identity and stores app sessions as token hashes.
- Production persistence: Supabase Postgres through `CloudStore`, in the owner-scoped `deadline_scout_records` table. Postgres advisory locking serializes mutations across Vercel instances.
- Scheduled checks: Supabase `pg_cron` calls the Vercel `/api/cron` endpoint every five minutes. The dashboard may be closed during source monitoring.
- Local development: Node 24+, local SQLite store and local interval scheduler. Local tracks are separate from hosted account data.
- Browser execution: the user's installed unpacked Edge extension, currently project version 1.9.5. Vercel cannot update an installed extension; reload it at `edge://extensions` after downloading/updating its folder.
- Services: Google Calendar/Tasks APIs, Brevo email, optional Gemini API. Credentials remain in server environment configuration; never put secrets into extension files, commits, examples, logs, or this guide.

Preserve the configured Supabase/Postgres + Vercel architecture. Do not switch to Render, Neon, static-only hosting, SQLite in production, or create replacement cloud resources. `AGENTS.md` has additional deployment instructions. Never deploy `.env*`, `data/`, keys, browser profiles, or user databases.

## Main user and data flow

```text
Public URL or active browser tab
  → extension scanner / backend safe fetch and optional isolated renderer
  → date and context extraction (rules; optional Gemini suggestion)
  → duplicate grouping and user review/confirmation
  → owner-scoped track snapshot in Postgres (production) or SQLite (local)
  → scheduled reread → compare against confirmed snapshot
  → timeline/change record + browser alert / opted-in email
  → optionally sync an explicitly linked Google event/task
```

The extension can scan the active tab or send a copied/pasted link to the website. Automatic monitoring fetches publicly readable sources; it does not borrow the user's browser cookies, bypass sign-ins/bot checks, or safely replay arbitrary form submissions. Read `docs/GENERIC-MONITORING.md` before changing the source reader.

### Dates and change tracking

Extraction is in `extension/shared/dates.js`, `extract.js`, `page-scanner.js`, and supporting `milestone-selection.js`. Labels must stay contextual and may describe any schedule item (for example submission, payment, results, or a source-specific milestone); do not constrain the product to only event date and registration close. Prefer source headings/nearby text. IST (`Asia/Kolkata`) is the default for a timed value when the source gives no zone; an explicit source zone takes priority. Date-only values remain date-only.

The user reviews candidates and confirms the selected baseline. `server/engine.js` performs scheduled reads, and `extension/shared/compare.js` compares new source observations with the confirmed milestones. Unreadable sources, conflicting values, ambiguity, or missing dates preserve the last confirmed date and prompt review; they must never silently overwrite it. Duplicate handling must avoid both dropping legitimate same-day milestones and creating redundant copies. Follow `milestoneKey` / `dedupeMilestones` semantics in `milestone-selection.js`.

Removed tracked pages are the scope boundary for work and notifications. Keep email/browser queues owner-scoped and tied to active tracked records; removed tracks must not continue to consume monitoring or send stale alerts. Google writes occur only for explicitly linked milestones and must honor uncertainty/conflict checks.

## Backup Signup design and safety invariants

Main files: `extension/shared/signup.js`, `signup-collection.js`, `signup-resume.js`, `signup-files.js`, `signup-background.js`, `signup-receipt.js`, `signup-success-notices.js`, `extension/worker.js`, `extension/backup.js`, and `server/signups.js`.

1. **Capture is metadata first.** The extension captures field descriptors, labels, choices, constraints, URL, and step identity. It does not send field answers to a model. Multi-page captures belong to one same-origin draft; recapture should replace the matching step rather than duplicate it.
2. **Saved answers are reviewed snapshots.** Editing a draft increments its revision/disarms prior approval. Background execution is tied to an exact approved snapshot, tracked page, milestone, and schedule. Reapproval is required after material edits.
3. **Fill uses strict matching.** `resumePlan` compares URL/step identity and field metadata. Unknown visible questions, changed options or terms should prompt review; never fill an ambiguous field just because its label looks close. Optional hidden controls on a final review page are ignored (fixed in 1.9.5); keep required-field and consent checks meaningful.
4. **PDF bytes are deliberate and bounded.** Approved PDFs are encrypted in server storage, checked by identity/hash/size, and passed to the extension only for the approved run. No filesystem scraping or unattended access to arbitrary local files.
5. **Execution is browser-side.** The extension claims a scoped job token bound to one user, one draft revision and the website session, opens an inactive tab, and fills matching saved fields. This is not cloud browser execution; Edge must remain open and permitted. The browser/organizer can still pause for sign-in, OTP, CAPTCHA, payment, consent, upload failures, required fields, or uncertainty.
6. **Submit is a separate action, not a captured blank.** After all non-empty saved steps are visited, inspect final page controls. A final review page need not be captured. In version 1.9.5, hidden optional fields on that page do not count as new questions; visible added controls and hidden required controls still need conservative handling. If a single supported Submit control is present and checks pass, dispatch only once.
7. **Never blindly retry uncertain submission.** Persist submission intent before dispatch. If the browser or network fails after a click, the organizer may have received the registration. Report “submission requested”/needs review until an actual organizer receipt/confirmation is observed. Do not duplicate a potentially successful registration.
8. **Only show confirmed success with evidence.** `signup-receipt.js` looks for organizer confirmation plus receipt evidence; a visible submit button is not confirmation. Notification/email should be tied to this status and the active draft.
9. **Queue and status transitions must reconcile.** Browser-local jobs and server states (Armed → Waiting for browser → Browser running → Submission requested/Needs review/Confirmed) can diverge. On future work, make failures visible and recoverable; do not silently lose a queued job or report a successful pickup before acknowledgment. The user previously supplied an Edge snapshot showing the final review page was blocked because hidden optional `team_name` and `team_photo` were treated as unmatched fields; the 1.9.5 change addresses that specific case.

Review the detailed flow and known limits in `docs/backup-signup.md`. That guide may contain historical release notes, so use current source and `package.json` version rather than assuming every old paragraph describes today's behavior.

## Security and data ownership

- Every user's tracks, history, drafts, files, profile, links, and delivery state are partitioned by authenticated owner. Preserve ownership checks on every route and storage lookup.
- The browser gets narrowly scoped opaque sessions. It must not receive the Google provider's access/refresh tokens, database URL, publishable/service keys, Brevo key, or encryption key.
- Provider credentials and sensitive user data are encrypted or held server-side. Keep secrets out of logs and tool output.
- Public URL fetches use URL/DNS/redirect/private-IP/size/time guards. Do not add a path that lets user-supplied URLs reach localhost, cloud metadata, private hosts, or arbitrary ports.
- Do not weaken consent/payment/CAPTCHA/OTP boundaries to make autofill appear more complete. Review user-approved answers, and never treat a source site's submit click as proof of registration.

## Where to make changes

| Concern | Primary code |
| --- | --- |
| Dashboard UI and interactions | `extension/panel.html`, `panel.css`, `panel.js`, `dashboard.js` |
| Browser popup and active-tab scan | `extension/popup.*`, `extension/worker.js` |
| Website ↔ installed extension bridge | `extension/website-bridge.js`, `extension/api.js`, `extension/backup.js` |
| Extraction and time parsing | `extension/shared/extract.js`, `dates.js`, `page-scanner.js` |
| Duplicate/candidate selection | `extension/shared/milestone-selection.js` |
| Snapshot comparison | `extension/shared/compare.js` |
| Monitoring scheduler and Google sync | `server/engine.js`, `server/google.js` |
| Routes, auth, sessions, assets | `server/app.js` |
| Signup browser jobs and server states | `server/signups.js`, extension `shared/signup-*.js`, `worker.js` |
| Local storage | `server/store.js` |
| Vercel/Postgres transaction storage | `server/cloud.js`, `server/cloud-store.js`, `server/cloud-database.js`, `Dockerfile.vercel` |
| Brevo and message markup | `server/email.js`, `server/email-template.js` |
| Optional model-assisted extraction | `server/model.js` |

If adding a website-loaded JS/CSS asset, update the public-file allowlist in `server/app.js` as appropriate. A missing allowlist entry can make hosted pages fail even when local pages work. Keep API behavior aligned in local and cloud runtimes.

## Safe workflow for future features

1. Read `AGENTS.md`, this guide, the closest feature documentation, and the actual implementation before editing. Check `git status` first; preserve any existing user work.
2. State the observable behavior that should change and the existing invariants it must preserve. Trace both UI and backend/extension paths for any cross-boundary change.
3. Prefer a narrow, backward-compatible change. For storage/schema changes, account for existing records and old extension versions. For jobs, enumerate success, pause, cancellation, deletion, logout, timeout, and uncertain outcomes.
4. Keep demo behavior distinct from real Google/Brevo/organizer integrations. Never silently mock a live integration or claim an unperformed live check.
5. Add/update meaningful regression coverage in the relevant `test/` file when testing is requested/required by the active task. Browser behavior should be tested in a controlled local form; do not submit real external registrations as a test.
6. Run appropriate checks, inspect the diff for secrets and unrelated edits, and explain any unverified live behavior. Do not say tests passed unless they were run.
7. The user wants website/extension changes pushed to GitHub and the configured Vercel production updated. Follow `AGENTS.md`, deploy only the intended project, verify production health/assets, and report that an unpacked Edge extension still needs a user-side reload. Do not delete deployments or production data as part of a routine feature change.

## Handy reference

- Repository root is this document's parent directory (`Deadline Scout`).
- Unpacked Edge extension folder is `<repository root>\extension`.
- Production site is `https://deadline-scout.vercel.app`.
- Current release when this guide was written: **1.9.5**.
- Start local app: `node --env-file-if-exists=.env server/index.js` (Node 24+).
- Full regression suite: `node --test`; syntax/assets check: `node scripts/check.js`.
- Never paste `.env` contents into chat or commit them.

# Backup Signup

Backup Signup is part of Deadline Scout. Open `/backup.html` from the dashboard navigation. It reuses your Google sign-in and active tracked pages.

## Setup

1. Update the source and reload Deadline Scout at `edge://extensions` (or `chrome://extensions`). The unpacked folder remains `extension` in this project. Version: 1.6.0.
2. Refresh the hosted dashboard and open **Backup signup**. Sign in on the dashboard if needed.
3. Save your signup name, phone, affiliation, and named links. Email comes from the signed-in account. GitHub profile and repository links, videos and decks have separate link types. Multiple matches are left for your choice.
4. Track the relevant event/page and its deadline before arming a signup. Ordinary form destinations can differ from the tracked event's domain.

No new keys, npm dependencies, database tables, DNS settings or Supabase migrations are required. The existing owner-scoped `deadline_scout_records` table stores the new `signup`, `signupProfile`, and `signupFile` kinds. The existing encryption key encrypts answer snapshots, profile links, and private file bytes. Existing RLS and server ownership checks continue to apply. Do not expose the encryption key or database connection in extension code.

## Ordinary-site walkthrough

1. Open the actual form and click **Prepare signup** in the extension. If several forms are present, select the intended form and click again. Active-tab access is used, without requesting all-site permissions.
2. Review every label, answer, option, required flag, URL, help instruction and file constraint. Arbitrary custom controls, consent, passwords and embedded forms remain manual. A sign-in wall must be completed on the site.
3. Choose files explicitly. Ordinary-site files stay on your device; only their filename, size and type are saved as a checklist. The extension does not claim they are uploaded or attach them automatically.
4. For multi-step forms, navigate to each step yourself, click Prepare signup again, then **Append captured step** to the existing draft. Review all steps before marking them complete. At resume, choose the captured step in the popup, including when steps share a URL.
5. Select the active tracked page, review the exact snapshot and save. The saved answers will not change when the profile changes. Editing a saved draft disarms it.
6. Choose a deadline and backup time. The screen shows the exact local time and UTC representation. A fixed time pauses if the deadline changes. A relative rule follows the approved offset; if the recalculated time has passed it asks for review instead of silently executing.
7. At backup time, the email and browser queues produce **Ready to finish** with a Resume signup link. Open the draft, click Resume signup, and on the form click **Restore approved answers** in the extension. New required fields, changed options and terms are flagged; clearly unchanged fields can be restored. Attach the named files and handle CAPTCHA, OTP, sign-in, consent and submission yourself.
8. Use **Cancel backup** or **I already registered** to stop it. Removing the tracked page cancels its backups and pending alerts.

Common input constraints (required, allowed options, email, HTTP(S) URL, explicit hostname, length, file type/size/count) are checked. Complex site-specific patterns and custom widgets still require the site's own validation. Sharing permissions cannot be independently verified; a published sharing instruction requires your confirmation. Unknown file limits remain labelled unknown. No automatic submission is available for ordinary websites.

## Demo organizer walkthrough

This is an internal simulator, not a real event registration or third-party organizer integration.

1. Open `/signup-demo.html`. Its test deadline is September 12, 2030 at 17:00 IST, and the registration is free.
2. Track that page's test deadline on the main dashboard. Open the form, then use Prepare signup in the extension (the demo also offers a website-only capture shortcut).
3. Use a test name, an address such as `scout-test@example.com`, a GitHub repository URL and a small valid `.pdf` proposal. Max size is **200 KB**. The demo explicitly supports a private upload; the server stores encrypted bytes with a unique version and SHA-256 digest. Replacing the chosen file creates a new reference and needs fresh approval.
4. Save the reviewed draft. Select **Automatic submission · demo organizer only**, choose a backup time shortly in the future, and approve. The exact snapshot and destination are shown before arming.
5. After that time, click **Run due backups now** for a short demonstration, or let the existing five-minute cloud cron run. The scheduler is not second-precise.
6. The internal organizer records the approved answers and exact file content in an encrypted simulated registration and returns a `DEMO-...` receipt. A repeat draft for the same account/email reports Already registered. A timeout is reconciled through the stored receipt before another attempt. No real third-party signup occurs.

Private uploads expire after seven days; missing, expired or changed references pause automatic submission. A changed schema/version, new fee, closed/uncertain status, new terms, or unresolved deadline also pauses for review. Only this explicitly supported demo path can submit automatically. Adding a real organizer later requires its own authenticated status API, schema checks, upload support and duplicate-safe adapter.

## Verification

- `node --test` runs regression tests and `test/signups.test.js` checks mapping, URL distinctions, multiple uploads, wrong type, missing files, encryption and owner isolation, immutable snapshots, demo receipt/idempotency, already-registered detection, schema/terms/fee changes, timeout recovery, cancellation, removal and relative timing.
- Browser QA exercised actual DOM capture on the controlled Scout Lab form, saved suggested/edited answers and a private PDF, armed the demo snapshot, reopened the form and restored text/email/repository fields. The file remained a manual attachment on the form, as intended.
- The website-only demo shortcut uses the same capture/restore functions as the extension injection. Physical Edge popup-to-website handoff still requires the installed extension to be reloaded and tried in that browser; automated tests and website shortcuts do not establish that physical-browser result.
- No real organizer submission or real test email was sent during QA. Brevo continues to use the existing email preference and verified Google recipient. Mapping uses local rules; no AI key is needed and no profile values/files are sent to an AI provider.

## Guided editor and step ordering (1.6.1)

The editor now stays in the page with three stages: Choose event → Review answers → Set backup. Continue from Choose event saves an unfinished draft automatically. Optional profile fields and demo controls are collapsed. Closing the editor never deletes saved data or waits for a network request.

When you capture another form page, choose its existing draft in Continue a signup and click Add to selected draft. The server merges that step atomically; a recapture of the same form preserves answers and avoids a duplicate step. Stale tabs cannot replace newer data. In Your drafts, use the up/down buttons beside each step to save a custom step order. Changing an armed draft’s order disarms it and requires fresh approval.

Browser checks on a disposable local account covered save, arming, opening the form, cancellation, close, reordering across reload, and capturing a third page into the same draft across reload. Installed Edge extension messaging remains a separate manual validation boundary.

Delete draft removes a signup from Your drafts and stops its scheduled backup and queued signup alerts. Undo draft deletion restores it as an unarmed draft, requiring fresh review before it can run. Account data clearing also removes deleted draft records.

## Fill now and event sections (1.8.0)

Drafts are grouped by tracked event. Expanded dashboard event cards show links to the same drafts and their registration pages. Review answers uses Save & continue as the explicit snapshot review; the old review checkbox was removed. Navigation tabs are clickable, but unsaved answer edits must be saved before leaving Review answers. Saving is not submission.

Fill form now opens the saved form through the installed extension immediately, independently of the backup time. The first time on a site, the extension must receive optional site permission: click its toolbar icon and Enable autofill on this site. During the resulting 30-minute session, matching steps in that tab fill as pages finish loading or as a single-page form changes. Each matching step is filled once so later user edits are not repeatedly overwritten. An on-page message lists the result and links to the next saved page; the extension does not blindly click Next or Submit. Files, consent, CAPTCHA, OTP and payment remain manual on ordinary websites. Missing or changed controls and terms require review.

The demo form also has ?step=1 and ?step=2 variants for controlled multi-page testing. Register now on the full demo organizer runs the approved demo integration immediately and requires a real demo receipt before Confirmed. Ordinary-site registrations are never automatically submitted. Automated tests exercise manual fill dispatch across multiple steps, permission checks, site/terms mismatches, and immediate demo submission. The installed Edge flow and live multi-page browser execution could not be rechecked in this session because the browser connection was closed.

## Explicit browser submission sessions (1.8.1)

The scheduled ordinary-site backup remains a reminder. A separate user-initiated Fill & submit approved form button now enables an extension session that attempts a single submission of matching saved answers. It requires site permission, an unchanged terms snapshot, no changed/new required controls, valid answers, any required files already attached, no unresolved consent, and a unique clearly labelled registration Submit control. It pauses at detected payment, sign-in, OTP or CAPTCHA. For intermediate steps, it only clicks a unique Next/Continue control whose type is button; submit-type navigation remains manual. This is best-effort browser automation, not a supported organizer status API: a requested submission is never labelled Confirmed. The session records submission intent before dispatch and never retries an uncertain attempt. Only the demo API has receipt-based confirmation.

Saved-step selection from the popup is now passed to the fill worker. Step matching ignores known tracking parameters; manually selected steps may match the same origin/path but still require matching field metadata and terms. Failures are displayed on the form. Live installed Edge execution remains unverified because the browser connection was closed; automated tests use controlled document/browser doubles and do not prove compatibility with arbitrary third-party forms. Dashboard cards show Signup drafts only when drafts exist; Prepare a Signup is always available beside Pin, and ordinary milestone evidence links are removed.

## Same-page wizard fixes (1.8.2)

The live Edge investigation reproduced a missing extension identity on an old saved draft and found Edge still running 1.3.10. Reloading loaded 1.8.2 from the existing folder. A website-only bridge now announces the public installed extension ID without exposing credentials. Captures also retain this ID for older drafts.

Capture every form stage, including the final review stage even when it contains no answer fields. Visible panel/tab identity distinguishes stages sharing one URL. The popup defaults to automatic current-step detection. Intermediate navigation validates visible fields, recognizes descriptive Next/Continue labels, and does not block on later hidden uploads. Final submission still validates the full form. Pauses can resume after manual attachments/consent without restoring over user edits; uncertain submission attempts are never repeated. Status-panel updates no longer trigger their own observer loop.

A real headless Edge regression test covers a three-stage same-URL form, required uploads, empty review-stage matching and one submission into a local test handler. This does not establish compatibility with every organizer. Scheduled ordinary-site backups remain reminders, while immediate user-approved browser sessions require an open browser and per-site access.

## Approved PDF autofill (1.8.3)

Select a PDF in Review answers, then Save & continue. PDFs up to 2 MB are encrypted in the existing owner-scoped signupFile records, expire after 7 days, and have a 20 MB account limit. Up to 4 MB of approved PDFs may be attached in one immediate browser session. Other file types remain manual. The website explains this before file selection.

The owner-only draft file endpoint releases bytes only for a reviewed, active draft referencing that immutable file version. The website sends these bytes to the installed extension only when Fill form now or Fill & submit approved form is clicked. The extension holds file bytes in trusted session storage, separate from durable draft metadata, for the 30-minute browser session and clears them when its target tab closes. There is no filesystem scanning or path-based file access.

On a matching captured step, the injected attachment function verifies metadata, PDF header, SHA-256 and upload constraints, creates a File and DataTransfer, assigns the resulting FileList to the unique visible upload input, and emits input/change events. Existing user-selected files are preserved. Unsupported controls and failed checks require manual attachment. Review Submission navigation is recognized only as a non-submit button; organizer submission confirmation remains separate.

Automated browser coverage verifies FileList/FormData contents, the site change callback, tampered-byte rejection and preserving an existing selection. Backend tests cover ownership, snapshot approval, unrelated file references, expiry and size limits. Live Edge confirmed the existing two-step draft restored its project fields; no final registration was submitted.

## Background signup jobs (1.9.0)

After saving the answer pages and PDFs once, Run background signup now queues an approved run immediately. Alternatively choose Fill and submit in background in Action and Turn on backup to run at the configured backup time. The extension opens an inactive tab, so the organizer website does not take focus and the dashboard may be closed. Edge must remain running with the extension enabled, prior site access granted and any required organizer sign-in still valid. This is browser automation, not cloud execution while the computer is off. The alarm polls once per minute; start before the deadline with enough margin. An overdue closed deadline pauses rather than submitting late.

A narrowly scoped browser-signup token is bound to one owner, draft revision and parent website session. It can only poll/report that approved job. The server atomically claims the job once and returns its approved snapshot/PDFs. Reapproval, edits, cancellation, removing the tracked event or signing out invalidate execution. Multiple queued jobs run sequentially; an active browser session occupies one slot. The website refreshes job status every 15 seconds without overwriting unsaved answers.

The final empty review screen does not need another captured/saved step. After every captured answer step has been restored without schema warnings, the extension inspects all controls in the existing form, including inactive panels, against the approved schema. If no new questions or changed terms exist and native validation passes, it uses a unique registration Submit control. Consent, payment, CAPTCHA, invalid/missing files, new questions and ambiguous controls pause. A final screen that hides the original form state entirely may still need manual review: the extension cannot verify an arbitrary site's session state from a blank page.

Submission intent is persisted before dispatch. Unknown outcomes are never retried automatically, and Submission requested is shown instead of claiming a confirmed registration. The organizer receipt remains authoritative. Tests cover scoped-token access and logout revocation, one-time claims, reapproval/deletion, inactive-tab creation, and an actual browser two-answer-page/PDF flow that submits an uncaptured empty review once into a controlled test handler. No external organizer registration was submitted during development of this change.

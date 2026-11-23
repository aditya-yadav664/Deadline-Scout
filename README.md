# Deadline Scout

A Manifest V3 side panel for Microsoft Edge and Google Chrome that watches registration schedules, explains meaningful deadline changes, and connects to real Google Calendar, Google Tasks, and Brevo email.

Built for the **Beyond the Browser** hackathon track. Plain HTML/CSS/JavaScript extension, Node.js backend, SQLite storage. Generic JavaScript rechecks use **playwright-core** with an existing Edge/Chromium installation. Node.js **24 or newer** is required for built-in SQLite and environment-file support.

## Start here

The project is already built. To try it before creating any accounts, run these exact commands in Windows PowerShell:

```powershell
Set-Location -LiteralPath 'C:\Users\adity\Documents\Codex\2026-11-22\give-a-proper-prompt-to-build\outputs\deadline-diff'
node --version
node scripts/install-renderer.js
Copy-Item -LiteralPath '.env.example' -Destination '.env'
node --test
node scripts/check.js
node --env-file-if-exists=.env server/index.js
```

Copy `.env.example` only on the first setup; preserve your existing `.env` afterward. If `node` is missing or reports a version below 24, install Node.js 24+ from the [official Node.js download page](https://nodejs.org/en/download), reopen PowerShell, and run the commands again. `npm` is not needed.

Keep the server PowerShell window open. Open [the web companion](http://localhost:4317/) and [the fictional registration page](http://localhost:4317/demo/registration). The companion uses the same interface as the extension; active-tab reading and browser notifications require the extension.

Stop the server with **Ctrl+C**. Restart with:

```powershell
node --env-file-if-exists=.env server/index.js
```

## Install the unpacked extension in Microsoft Edge (current test target)

1. In Microsoft Edge, open `edge://extensions`. In Google Chrome, use `chrome://extensions` instead.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select:

   ```text
   C:\Users\adity\Documents\Codex\2026-11-22\give-a-proper-prompt-to-build\outputs\deadline-diff\extension
   ```

4. Pin **Deadline Scout** in Edge's Extensions menu.
5. Open a registration page and click its toolbar icon to open the side panel.
6. Use **Track this page**. If page access fails, click the toolbar icon again on that page and retry, or paste its public URL.
7. Enable **Browser alerts** in Settings when you want notifications. Permission is requested at that point.

If you extracted the ZIP somewhere else, select its `extension` folder instead. The folder contains the manifest, service worker, shared extraction code, and icons. No build step is necessary.

## Run the core demo

1. In Settings → Demo control room, apply **Original · 28 November**.
2. Paste `http://localhost:4317/demo/registration` into the tracking box, or use Track this page in the extension on that page.
3. Click **Add FAQ and updates** to approve the linked FAQ as another monitored source.
4. For a short demo, keep the first **Registration closes** candidate and uncheck the other candidates, including the duplicate FAQ date. Both source URLs remain approved.
5. Confirm the selected interpretation and set the planned signup date to **27 November 2026**. Save.
6. Settings → Demo control room → apply **Explicit update · 26 November**.
7. Watchlist → **Check now**. The confirmed deadline becomes 26 November. Timeline shows 28 → 26 November, the exact evidence sentence, its FAQ link, and the one-day-late impact.
8. Settings → Email activity shows one demo email, or a Brevo acceptance if live email is configured and enabled. The extension surfaces the browser alert when notification permission is enabled.
9. Check again. No duplicate change or email is created.

Changing a demo mode changes only fictional source pages. It does not edit the saved deadline directly. To repeat from the original state, remove the test registration through Manage, set the source to Original, and track it again.

## Connect live services

Follow [the beginner's account setup guide](docs/LIVE-SETUP.md). You will create three things:

| Service | Purpose | Where its values go |
| --- | --- | --- |
| Supabase | Verified Google sign-in | Project URL and publishable key in `.env`; Google provider configured in its dashboard |
| Google Cloud | OAuth client, Calendar API, Tasks API | Client ID and secret in Supabase and server `.env` |
| Brevo | Transactional email | API key and verified sender in server `.env` |

The implementation makes real API calls when configured. Calendar and Tasks are never silently simulated. Missing Google configuration shows a setup/reconnect error. The email fallback is explicitly marked **Demo · no emails sent**.

Supabase is used for authentication here; tracking records remain in SQLite. A Supabase service-role key is **not** required. Google provider tokens remain encrypted on the backend; the extension receives a separate opaque application session token.

After Google sign-in, your verified Google email can receive alerts. Enable Email alerts explicitly. To use another recipient, request its six-digit verification code, read the email in that inbox, and confirm the code. Demo verification does not verify a real address, and live verification codes are not exposed by the activity API.

New Google sign-in uses a separate user namespace; local-demo registrations do not automatically become part of a signed-in account. Track the demo again after connecting Google.

## Calendar and Tasks behavior

- The two buttons are separate actions. Select a milestone and approve the action.
- Calendar date-only deadlines become all-day events with an exclusive end date the following day. Preview shows the reminder time using your primary Google Calendar timezone. A one-hour reminder for an all-day deadline is one hour before midnight at the start of that date; choose a timed deadline if you want a different cutoff.
- Timed events use the confirmed timezone. Ambiguous daylight-saving clock times require an explicit UTC offset.
- Tasks contain a due **date** and registration/source links. Use Calendar when you need a reminder at a specific time. The [Tasks resource documentation](https://developers.google.com/workspace/tasks/reference/rest/v1/tasks) describes the due field's date-only behavior.
- Calendar uses a deterministic event ID. Tasks persist creation intent and a unique note marker. Retrying an uncertain Task creation searches for that marker before considering any other operation.
- Confirmed deadline changes show **Update Calendar event** / **Update Google Task**. Click to review and approve. Manage offers an explicit automatic-update opt-in; uncertain/conflicting milestones pause writes.
- If a Task POST may have succeeded but no matching Task can be found afterward, the backend refuses to post another Task. This is deliberately surfaced for review because the Tasks API has no client-selected task ID. Inspect Google Tasks before changing its stored operation record.
- Disconnect removes the server's stored Google tokens. For complete revocation, also remove the app in your Google account's connected-app settings.

## Monitoring and extraction

The server checks due registrations every 15 seconds and fetches each track according to its configured interval (5 minutes to 7 days). It must stay running; the browser can be closed. No cloud hosting has been provisioned by this project.

The source reader handles public HTML/text pages, Schema.org Event JSON-LD, English month dates, ISO dates, numeric date ambiguity, times, and explicit timezone offsets/IANA zones. When the renderer is installed, it executes page JavaScript in an isolated, cookie-free browser, with public read-only requests routed through the URL guard. It does not bypass logins or bot protection. Pages requiring those features show a check error and keep the last confirmed dates. Use a public FAQ or a manual reminder for such sources. It is not a universal extraction engine for PDFs or every language/layout.

Missing years and ambiguous numeric formats require confirmation. Date-only values stay as `YYYY-MM-DD`. Per the user preference, timed values without a timezone default to India Standard Time (`Asia/Kolkata`, UTC+05:30); explicit source timezones take priority. Corrections to unchanged ambiguous source text are remembered. A new ambiguous date needs another review. For a source announcing a change from an old date to a new date, the new date can supersede stale copies. Unexplained disagreement shows both quotes and keeps the last confirmed date.

With no backend, the extension can store local tracks and manually recheck readable public URLs while your browser is open, requesting each site's permission as needed. Local history is retained in Chrome storage. Local-only records do not send backend emails or run unattended checks. Explicit manual reminders are never automatically rechecked. Sync local records to enable backend monitoring.

## Optional Gemini fallback

Leave it off for the core demo. To enable it, set `GEMINI_API_KEY` and a model name in `.env`, then restart the server. It is used when deterministic extraction finds no milestone on a fetched page. Returned quotes must be exact substrings of the retrieved text. Model results always require human review; regular JavaScript compares the confirmed dates.

The adapter uses the [Gemini generateContent API](https://ai.google.dev/api/generate-content). The example model is `gemini-2.5-flash-lite`; check the [deprecation list](https://ai.google.dev/gemini-api/docs/deprecations) before choosing a model. An unavailable model produces a visible extraction error rather than a fabricated date. No live model call has been tested without credentials.

## Email delivery and retries

Each schedule change has a unique ID and separate browser/email delivery records. Brevo receives a stable `IdempotencyKey`, as documented in its [email idempotency announcement](https://developers.brevo.com/changelog/2021/11/10). Transient failures retry with backoff within a 14-minute safety window. Brevo's documented idempotency lifetime is 15 minutes; older uncertain sends require review instead of risking duplicates. `accepted` means accepted by Brevo, not confirmed delivery to the inbox. This implementation does not consume Brevo delivery/bounce webhooks.

Browser alerts remain queued while your browser is closed. The service worker polls once a minute, uses a deterministic notification ID, then acknowledges the queue entry. Notifications require both extension permission and OS notifications to be enabled. A crash between notification display and acknowledgement can cause the same notification to be refreshed; this is not a guarantee of exactly-once display across all browser/OS failures.

## Persistent hosting

Local development writes `data/deadline-diff.sqlite`, WAL files, and a generated encryption key. `.env` and `data/` are excluded from the source archive and Docker build. Keep the database and key together when backing up local data.

For hosted use, run one always-on Node process with a **persistent disk** mounted at `DATA_DIR`, HTTPS in front of it, and a stable `TOKEN_ENCRYPTION_KEY`. An ephemeral filesystem will lose your records. Supabase Auth alone does not keep this process or its scheduler running.

A Dockerfile is included, but has not been built or deployed here. Example after configuring `.env` for your real HTTPS backend URL and extension ID:

```powershell
docker build -t deadline-diff .
docker volume create deadline-diff-data
docker run --name deadline-diff --restart unless-stopped --env-file .env -e HOST=0.0.0.0 -e DATA_DIR=/data -e ENABLE_DEMO=false -p 4317:4317 -v deadline-diff-data:/data deadline-diff
```

Put an HTTPS reverse proxy in front, set `APP_URL` to its external HTTPS origin, update Supabase's callback allowlist, and save that backend origin in extension Settings. Non-loopback startup requires Supabase configuration, an encryption key, and explicit `EXTENSION_IDS`. Do not deploy multiple scheduler processes against the same database; locking in this version is per process. Account lifecycle, database growth management, and operational monitoring would need further work before a large public rollout.

## Security choices

- All tracking/history/delivery/Google-link queries are partitioned by authenticated owner.
- PKCE is used for Supabase's code exchange and the extension's one-time redemption; a browser cookie also binds the OAuth callback to the sign-in flow.
- Server sessions expire after 30 days and store only token hashes. Sign out invalidates the current session.
- Provider tokens use AES-256-GCM at rest. Never commit `.env`, generated local key files, or databases.
- Public URL fetching rejects non-HTTP(S) schemes, credentials in URLs, private/reserved IPs, and non-web ports. DNS results are validated and pinned for the connection. Every redirect repeats validation. Responses are bounded by size and timeout.
- The sole local-source exception is the exact in-process fictional demo routes; arbitrary localhost requests are blocked.
- The minimal host permissions allow the local backend. Site/backend permissions and browser notifications are requested as needed.

## Project map

```text
extension/             Install this folder with Load unpacked
  panel.html/css/js    Side panel and web companion
  api.js               App sessions, storage, Google sign-in launch
  worker.js            Browser alert queue consumer
  shared/              Extraction, date validation, comparison
server/
  app.js               Authenticated routes and OAuth callbacks
  engine.js            Scheduler, comparisons, durable alerts and retries
  fetch-page.js        Public-only URL reader with DNS pinning
  google.js            Real Calendar/Tasks adapters
  email.js             Brevo and explicitly labelled demo adapter
  store.js             Owner-partitioned SQLite records
  security.js          URL validation, session hashing, token encryption
  model.js             Optional Gemini extraction adapter
  demo.js              Controllable fictional source pages
test/                  Native Node.js tests
docs/LIVE-SETUP.md     Beginner service setup
docs/DEMO-SCRIPT.md    60-second walkthrough
docs/TEST-REPORT.md    What was actually verified
```

See [the test report](docs/TEST-REPORT.md) for the distinction between automated mock tests, browser checks, and live integration checks still requiring your accounts.

See [generic extraction and rendered rechecks](docs/GENERIC-MONITORING.md) for the current monitoring pipeline, setup, tests, and limitations. This supersedes older descriptions of JavaScript-only pages being manual-only.

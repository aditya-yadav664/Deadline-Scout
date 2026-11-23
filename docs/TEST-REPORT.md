# Verification report

Verified locally on **22 November 2026**, Windows, Node.js **v24.22.3**.

## Automated checks actually run

```powershell
node --test
node scripts/check.js
```

**32 tests passed, 0 failed, 0 skipped.** Syntax and manifest-entry checks cover **23 JavaScript files** and all referenced manifest assets.

Follow-up fix: public URL inspection works before Google sign-in while saved server records remain authenticated. Verified the Devnovate wHACKiest URL returns a JavaScript-only shell, now shown explicitly with a manual-reminder fallback. Its rendered schedule is not automatically monitored by this backend.

Tests cover:

- Detection of separate milestones, JSON-LD dates, and same-site FAQ links.
- Original 28 November → explicit FAQ update 26 November, with a 27 November plan.
- A readable impact message, before/after history, one queued browser alert, and one demo email.
- No duplicate change/email on a repeat check; a repeat explicit update remains stable.
- Banner-only and wording-only changes do not create date alerts.
- Conflicting sources preserve the confirmed date; approved resolutions remain stable on unchanged evidence.
- Failed fetches preserve confirmed dates and record a check error.
- Scheduler tick processes a due registration without extension polling.
- Ambiguous date formats, missing years, missing zones, invalid dates, uppercase meridiem, timezone conversion, and daylight-saving gaps/repeated hours.
- Persistent SQLite reopen, owner partitioning, and AES-GCM round-trip encryption.
- Public URL validation rejects local/private/reserved addresses and non-HTTP schemes.
- Brevo request payload and stable idempotency header using a **mock HTTP transport**.
- Unverified recipients cannot enable live emails. Live verification codes are omitted from API activity responses. Demo verification never verifies a real recipient.
- Supabase OAuth/PKCE handshake, callback-cookie check, verified-user lookup, invalid redirects, and single-use redemption using **mock Supabase responses**.
- Calendar all-day payload/end-date semantics, registration links, and Task due-date payload.
- Google Calendar/Tasks create then update existing IDs using **mock Google responses**.
- A Task request that loses its response recovers through its note marker without another POST.
- Conflicting milestones refuse Google writes.
- Transient email retry and stopping unsafe retries beyond the Brevo idempotency window.
- Optional model adapter rejects invented evidence quotes and marks accepted quotes for human review, using a **mock model response**.

## Browser checks actually performed

Used the local web companion at `http://localhost:4317/` in the in-app browser:

1. Pasted the fictional registration URL and inspected all five detected milestones.
2. Approved the linked FAQ source, selected the closing deadline, confirmed it, and saved a 27 November plan.
3. Applied the explicit 26 November FAQ update and clicked Check now.
4. Verified the timeline displayed 28 → 26 November, the evidence/source, and the one-day-late impact.
5. Verified the demo email activity contained that same change and was labelled **DEMO ONLY · no email sent**.
6. Inspected the layout at 400px and 1024px widths.
7. Read browser error logs: no errors were reported during those checks.

A screenshot is saved alongside the project as `deadline-diff-preview.jpg`.

The public fetch transport was also exercised against `https://example.com/`: it successfully retrieved the Example Domain title and 172 characters of text using the validated/pinned public DNS path. This is a transport smoke check, not evidence of universal registration-page extraction.

## Checks still requiring real accounts or Chrome installation

- Loading this unpacked folder into an actual Chrome profile and exercising active-tab capture.
- A real OS/browser notification, including Chrome closed/reopened behavior. The durable queue/acknowledgement path was verified through the API; actual Chrome notification display was not.
- A real Supabase project and Google OAuth consent/redirect round trip.
- Creating and updating real Google Calendar events and Google Tasks in a user's account.
- A real Brevo send, inbox receipt, bounce/delivery handling, and real-recipient verification.
- A live Gemini extraction call.
- Docker build and deployment, HTTPS/reverse-proxy configuration, and persistent-disk hosting.

No service credentials were supplied during the build, and no live email or Google entry was created. The application contains live adapters and exposes setup/reconnect errors instead of pretending those actions succeeded.


See FIXES.md for the OAuth return-asset repair and Devnovate live source adapter added after the initial build.

Milestone selector verified in the browser: registration closes shows 2026-11-24, selecting Event date shows 2026-12-01 with its evidence, selecting a missing payment deadline clears the date, and switching back restores the registration date. No extra registration was saved during this check.

Builders Table regression: its ISO local timestamp 2026-12-10T16:54 is now extracted as Registration closes, 10 December 2026 at 16:54, with missing timezone explicitly flagged. Verified against the live source and in the browser; this draft was not saved.

Latest generic-monitoring verification: 42 tests passed, zero failed/skipped, plus 32 JavaScript syntax checks. Includes isolated real-Edge rendering of a changing shared schedule and a private-network refusal test. The user's undisclosed platform was not tested. See GENERIC-MONITORING.md.

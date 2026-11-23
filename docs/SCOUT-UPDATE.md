# Deadline Scout: compact extension and full website

The product is now named Deadline Scout. Existing data and internal Google identifiers are retained so a rename does not duplicate Calendar/Task entries.

The extension toolbar opens a compact popup, not the full dashboard. Scan this page reads the active tab through activeTab/scripting permissions; it does not depend on backend availability. Review & track sends only detected milestone evidence and the page URL to a temporary encrypted, single-use review handoff. The website labels browser-only dates as manual unless the backend can independently read their schedule. Nothing becomes a saved monitor until the user confirms and saves.

The website continues to provide sign-in, milestone confirmation, saved registrations, timeline, source-conflict review, check intervals, Calendar/Tasks actions, email settings and delivery activity. Its original local address remains http://localhost:4317/.

For local development, `start-background.ps1` starts a hidden Node process and checks its health. It returns immediately if the backend is already running. Runtime logs and the process ID are in the ignored `data/` directory. This process still stops when the computer shuts down; always-on hosting remains necessary for checks when the PC is off.

After changing extension files, reload Deadline Scout on edge://extensions, then reopen its toolbar popup. No replacement installation is required if the loaded folder is unchanged. If the old sidebar remains open, close it and use the toolbar icon.

Verification: 37 automated tests and syntax/manifest checks passed. The restored website was opened in the browser, remained signed in, and displayed both saved registrations. Open dashboard was exercised from the hosted popup preview and reached that website. Native installed Edge popup capture and all live external writes have not yet been verified in this update; browser API transport tests use mocks.

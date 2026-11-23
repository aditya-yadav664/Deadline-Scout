# General page extraction and live change checks

The screenshot regression is handled by general schedule rules, not a site adapter. Supported patterns now include Last Time to Register; labels in adjacent table cells or separate lines; event times in a separate row; start/end time ranges; and doors-open times. Explicit UTC wins over the user's IST default.

## Rendered source reads

Install the renderer once with `node scripts/install-renderer.js`, or install package.json dependencies with npm. The setup script downloads the pinned playwright-core package from the npm registry and checks its SHA-512 integrity. It does not download a browser. Windows Edge is detected automatically; other installations can set BROWSER_EXECUTABLE.

For generic pages containing JavaScript, the backend now starts a fresh isolated, cookie-free Edge/Chromium context for each read. It executes page scripts and rereads their public GET data requests. The browser does not use your personal profile or login cookies. Service workers, WebSockets, non-GET operations, and direct fallback networking are blocked. Permitted resources go through the existing public-IP/DNS-pinning/redirect/size/timeout guard. Incomplete reads produce a failed-check status, not a false no-change result.

The deterministic milestone extractor runs on the rendered DOM. If GEMINI_API_KEY is configured, the contextual extraction adapter can supplement partially extracted schedules too. Exact model evidence is verified and new model interpretations require review. This is extraction with rules and an optional model, not a model trained online on each website or edit.

Generic rendering does not support login-only schedules, CAPTCHA/bot challenges, private/local-network pages, or applications whose schedule requires POST/WebSocket operations. It cannot observe changes that only exist in another user's localStorage. Dates must be present in a source the monitoring backend can read. These conditions are reported explicitly; manual reminders stay manual.

## Existing browser-only tracks

Earlier extension captures may have been saved as manual reminders. They are deliberately not silently converted. Open Manage and choose Verify source & enable automatic monitoring. The backend must find an unambiguous matching milestone before it enables checks. Reinspect/resave when adding newly recognized milestones to an existing registration.

## Automatic versus immediate checks

Background checks run at each registration's configured interval (initially hourly; minimum five minutes). Check now runs immediately. The website refreshes saved track status/history every 15 seconds while the watchlist/timeline is visible, without interrupting open edits. A manual reminder's Check now action explains that monitoring must first be enabled.

## Verification

The independent test platform is served as synthetic public HTML using a shared JSON schedule endpoint in an isolated real Edge process. It has event date, event start/end, doors open, and Last Time to Register fields in the screenshot's layout. The test changes the shared registration deadline, performs a fresh renderer read through the monitoring engine, verifies one change and queued alert, then verifies repeat checks create no duplicate. Another renderer test verifies a private-network fetch fails rather than bypassing the URL guard. These tests do not establish success on the user's undisclosed test URL.

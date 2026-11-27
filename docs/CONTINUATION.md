# Deadline Scout continuation

The November 27 request is to redesign the overview using screenshot 3 as inspiration for layout and features, and implement the Application Readiness Simulator shown in screenshots 1 and 2. Keep original Deadline Scout branding. The overview should surface a journey, tasks, documents, milestones, and a right-hand Scout panel. It should use actual watchlist and application data. Readiness should use checklist completion, open tasks and existing prerequisites, with adjustable start delays and estimates. The user also asked to save context before their usage limit.

## Starting point

GitHub main and Vercel were verified at ddecd65 before this work. Production URL is https://deadline-scout-test.vercel.app. Pushing main triggers Vercel in the adi-testing scope. See AGENTS.md. The starting working tree also has unrelated local changes in extension/backup.html, extension/manifest.json, extension/shared/signup-files.js, and extension/shared/signup-resume.js. Keep those out of this release.

Phase 4 shipped embedded Backup Signup, Ask Deadline Scout, Deadline Heatmap, Productivity Insights and Scout Memory, with 142 passing tests. The live backend did not have GEMINI_API_KEY configured. The simulator uses editable estimates and a deterministic calculation. Discovery, collaboration and validation phases are listed in EXPANSION-PHASE-4.md.

## Overview and readiness implementation

- The signed-in overview puts watchlist and application navigation on the left, a journey, shortcuts, tasks, checklist and upcoming milestones in the center, and the Scout assistant and risk queue on the right. The right panel stacks below the main content at smaller widths. Scout shortcuts prefill the existing assistant for review.
- Readiness Simulator is reachable from the overview, sidebar and application workspace. It loads the chosen opportunity through the existing owner-scoped API. Completion counts required checklist items. The suggested next move considers open tasks and prerequisites. Forecasts use calendar-day estimates, model independent work in parallel, and compare against a selected tracked milestone. The result warns when the forecast lands on or after the closing day. Same-day estimates have no time-of-day precision.
- Forecast inputs are session-only and do not change saved dates, checklist items, tasks, or Backup Signup drafts. One calendar day per open item is an editable starting estimate. No database migration is needed.
- Main files are extension/opportunities.js, extension/workspace-overview.css, extension/readiness.js, extension/dashboard.js, and server/applications.js. Test coverage is in test/opportunities.test.js. Run `node scripts/check.js` and `node --test`. Deployment follows AGENTS.md. Check GitHub main and the live production hostname for release status.

## Where to pick up

Phase 5 covers Smart Page Discovery, a sourced Opportunity Radar, and an on-page extension overlay. Phase 6 covers explicitly shared watchlists and role enforcement. See EXPANSION-PHASE-4.md. The readiness forecast can later support saved scenarios and configurable working days if requested. Gemini remains optional for the existing assistant and needs a server-side key to be active.

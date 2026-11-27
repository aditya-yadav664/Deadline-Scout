# Public homepage and dashboard

The public homepage is at `/`. It introduces Deadline Scout and includes an interactive walkthrough with fictional data held entirely in the browser. Log In and Get Started use the same existing Google sign-in. The signed-in homepage offers Go to Dashboard.

The workspace is at `/dashboard`. It verifies the existing account session before displaying the dashboard in hosted mode. The existing APIs still apply server-side owner and session checks. Local development keeps its existing local session mode. Legacy extension links with scan, opportunity, and alert setup fragments redirect to the dashboard. If sign-in is needed, the fragment stays in the browser for the return trip.

The desktop sidebar collapses from the header. On mobile, the same navigation opens as a drawer. The profile dropdown contains account shortcuts. Settings renders as a separate dashboard view. Search, notification shortcuts, and Quick Scan reuse the existing flows.

Overview reads upcoming dates, watchlist entries, pending tasks, website changes, risk, timeline and checklist/task progress from the current workspace. There is no schema migration.

The browser layout test checks the public homepage, dashboard, profile and Settings at widths of 1440, 1280, 1024, 768 and 390 pixels. Set `SCOUT_LAYOUT_SCREENSHOTS=1` and run `node --test --test-name-pattern="requested viewports" test/opportunities.test.js` to save captures under `data/layout-review`. The OAuth browser test exercises sign-in return with a controlled provider response.

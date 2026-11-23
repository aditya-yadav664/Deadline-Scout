# Login and tracking repair

The Google return page is served at `/auth/done`. Its relative script, CSS and icon URLs previously resolved under `/auth/`, where they did not exist. This left the return page unstyled and prevented session redemption. Asset URLs now resolve from the extension/site root, and an expired return link shows an explicit retry action.

The web companion now always calls its own server origin. An old or mistaken advanced server setting cannot redirect its sign-in/session requests to a registration website. The extension can still configure a separately hosted backend.

Devnovate event pages now use a source adapter for the site's public event-data endpoint, with the same public-address and redirect validation as ordinary page retrieval. The wHACKiest registration deadline was retrieved live as 24 November 2026. Its event start date uses ambiguous numeric formatting and still requires confirmation. This adapter supports Devnovate event URLs; it does not add a universal JavaScript renderer.

After URL inspection, the interface scrolls directly to the detected milestones. After saving, it shows the watchlist. Previewing dates and saving a confirmed registration remain separate actions.

The regression suite now includes root-relative asset resolution from the OAuth return page and extraction from Devnovate's public data. A live Google return and a saved watchlist card are separate browser verification steps; automated mock tests do not establish those outcomes.

## Live browser verification after the repair

The user completed real Google consent and confirmed returning to the styled homepage. The connected account was then observed in the browser. The wHACKiest registration URL was inspected, the unambiguous 24 November 2026 closing deadline was confirmed and saved to that account, and Check now successfully reread the real public source. The watchlist displayed Watching and Checked Just now. No Calendar event, Task, or email was created in this verification.

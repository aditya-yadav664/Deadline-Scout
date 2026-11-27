# Deadline Scout expansion · Phase 2

## Dashboard

The desktop navigation is a compact icon rail that expands on hover or keyboard focus without moving the content. On small screens it is an expandable row. Overview shows upcoming deadlines and highlights up to three high-priority opportunities when present. The date change feed lives in Timeline.

## Monitoring and intelligence

- **Change Intelligence** compares deterministic, labelled facts from two readable checks of the same public document. It captures supported categories such as fees, eligibility, requirements, registration availability and locations. The first check establishes a baseline. Changes retain the former and current excerpts and support category/date filters, jump-to-change navigation and persistent review status.
- **Website comparison** displays extracted excerpts side by side on desktop and stacked on mobile. The service stores the latest extracted facts and up to 40 before/after change records per opportunity in the existing owner-scoped table. It does not store whole web pages. A fetch failure or a redirect to a different document does not count as a removal.
- **Source verification** accepts user-approved public links. Existing URL, DNS and network limits apply. Multiple agreeing hostnames are displayed as cross-domain agreement. This does not establish that the sources are independent publishers. Explicitly attached verification sources require user review when dates conflict. Existing FAQ update authority is unchanged for legacy tracks.
- **Public PDFs** use a bounded `pdftotext` process. The containers include Poppler. The documented dependency for native installs is `pdftotext` on PATH. PDFs need selectable text within the first 20 pages. A failed read is shown as unavailable, and OCR is outside this release.
- **Opportunity summaries** show extracted facts with source links and quoted evidence. Summaries use labelled content and do not infer facts from unrecognized sections. The confirmed dates remain in the adjacent milestones card.
- **Risk Overview** explains time remaining, source uncertainty, recent unreviewed changes and pending signup status. Date-only milestones use end of day IST for this risk estimate. Document completion, task prerequisites and user priority depend on later application-workspace features.

## Storage and verification

There is no SQL migration. The additive `intelligence` record uses the existing SQLite and Postgres stores under the account owner and track ID. Monitor checks update it alongside milestone evidence. Account clearing and track removal clean up the new records. Date notification routes, extension permissions and Backup Signup behavior use their existing contracts.

`node --test test/opportunities.test.js` covers a controlled fee/eligibility change, document removal, ignored advertising, PDF evidence extraction, source conflict and removal, severity calculation, comparison review persistence, desktop hover and mobile navigation. Run the full regression suite with `node --test`.

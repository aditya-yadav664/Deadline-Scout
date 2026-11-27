# Deadline Scout expansion · Phase 0 audit

## 1. Current architecture

| Layer | Implementation inspected | Reuse in the expansion |
|---|---|---|
| Website | `extension/panel.html` and `panel.css` define the dashboard. `panel.js`, `dashboard.js` and `api.js` handle state, rendering and authenticated requests. `backup.*` is a separate editor. | Keep the current dark design, watchlist cards, dialogs, profile controls and scan flow. Add a responsive shell around them. |
| Browser extension | Manifest V3 popup, `worker.js`, `website-bridge.js` and shared scanners. The worker handles alarms, alert delivery and approved signup jobs. | Reuse active-tab scanning, optional origin permissions and the existing dashboard handoff. |
| HTTP and identity | `server/app.js` serves assets and API routes. Supabase Auth supplies identity, and application sessions have separate scopes for browser alerts and signup jobs. | Put new routes behind full account authentication. Derive owner from the server session. |
| Monitoring | `source-adapters.js`, `fetch-page.js`, `render-page.js` and shared extraction modules turn guarded public reads into observations. `engine.js` compares them with tracked milestones and queues alerts. | Produce content observations from the same successful reads. Keep date comparison, scheduling and alert delivery independently testable. |
| Persistence and scheduling | Local Node 24 SQLite stores JSON records. Vercel runs the Docker-packaged Node service and Supabase Postgres through `CloudStore`. Both stores use owner/kind/id keys. Postgres uses JSONB and a transaction advisory lock for writes. Supabase cron invokes the hosted endpoint. | Use the same store contract and keep stable track and milestone IDs. The hosted site previously verified in Vercel is `deadline-scout-test.vercel.app`. |
| Integrations | `google.js` links Calendar/Tasks. `email.js` handles Brevo and retries. `model.js` is an optional, evidence-checked extraction fallback. `signups.js` and extension signup modules own reviewed drafts and browser runs. | Keep each integration and its privileges separate. Use the existing drafts in workspaces and exclude their contents from assistant context by default. |

## 2. Existing feature inventory

- **Tracking and review.** Public-link and active-tab scanning, contextual milestone labels, date/timezone parsing, modal review, manual reminders, grouping, pinning, search, history, and dashboard toasts. Distinct milestone identities can share a date.
- **Partial multi-source verification.** Each track has approved source URLs. The engine compares observations, can retain competing candidates for review, and preserves saved dates on missing, conflicting or unreadable evidence. There is no durable observation history per source/milestone, independence classification, or official PDF extraction path.
- **Partial change intelligence and impact.** The engine writes before/after records and evidence for date changes and can explain the effect on a saved plan. It updates already-linked Calendar/Tasks entries after verified changes under the existing linking behavior. Structured non-date facts, review status and task dependency impact are absent.
- **Partial application management.** Backup Signup provides reviewed draft snapshots, a reusable signup profile, per-step capture, supported PDF storage and approved browser runs. It does not provide a per-opportunity notes, tasks and checklist workspace. Live Google Forms PDF attachment remains unresolved. Keep the existing local extension diagnostics isolated from this expansion.
- **Delivery.** Browser and email queues are scoped to the account and tracked page. The engine checks that a track still exists before delivery. Provider acceptance and organizer confirmation are distinct states.
- **Partial visual comparison and assistant.** The timeline shows a date-specific before/after card. Gemini can suggest extra date candidates when enabled. There are no stored page snapshots, section comparisons, or account-data chat.

## 3. Missing functionality by module

| Modules | Work remaining |
|---|---|
| A, E, J | Evidence-backed non-date facts and change review. Retained normalized snapshots, a section diff with filters and jump links, and source-grounded opportunity summaries. |
| B | Source-to-milestone evidence history, verification status, source inspection and bounded official PDF ingestion. Use existing conflict review as the confirmation path. |
| C, M, O | Explainable risk from dates, readiness and dependencies, a heatmap, and productivity summaries derived from actual records. |
| H, I, K, Q, R | Document checklists, notes, saved tabs and progress, prerequisite tasks and accessible graph, impact review, and a field-level opt-in passport. Reuse signup profile and drafts where appropriate. |
| D, P | Account-scoped assistant, local or provider-assisted evidence retrieval, conversation history and clear controls, and editable user-owned memory with provenance. |
| F, G, N | Permission-aware opportunity suggestions, tracked-context overlay, approved discovery feeds, interests and saved results. |
| L | Private shared lists, invitations, roles, assignment, comments and audit activity. Existing groups are personal. |

## 4. Data and migration plan

- Keep existing `track` records and their nested milestones authoritative. Use owner + track ID and, where applicable, existing milestone ID on new records. Keep the current `change` and `delivery` records. Give richer change events a versioned shape and expose legacy date events through a read adapter that leaves missing legacy evidence unknown.
- Add additive source relationship, observation, and snapshot records. An observation records source, milestone or extracted category, exact evidence, time and outcome. Keep document identity and content hashes separate. Deduplicate normalized content and apply caps and retention to new snapshot history. A failed fetch creates a check outcome, never a removal diff.
- Reuse the local and cloud records stores for bounded owner-owned additions. Put predictable lookup fields in indexed columns or tested expression indexes when the query requires it. Provide equivalent, repeatable SQLite and Postgres migrations for schema/index changes. Keep IDs UUIDs for new entities. Enforce references to nested legacy milestones through the service because those IDs have no standalone database rows.
- Give workspace notes, checklist items, tasks and dependencies independently addressable IDs. Keep one workspace per track. Store links to reviewed drafts and document references; keep bytes and private answers in the existing protected storage. Reject dependency cycles and cross-owner references.
- Add indexed and constrained tables for shared lists, membership and invitations when collaboration lands. Validate role on every backend operation and keep private records out of shared queries unless the owner explicitly shares an approved projection. Store new user-owned data in the account-clear/delete lifecycle and define separate semantics for shared membership and history.
- Validate migrations on a disposable Postgres database and a legacy SQLite fixture. Verify the deployed Supabase schema and migration access read-only before applying changes. This audit inspected repository DDL and store behavior. It did not query or alter the live database.

## 5. Website and navigation plan

Use one responsive shell and progressively expose routes as features ship. Preserve the existing scan form and event actions in My Watchlist. Keep current Backup Signup URLs and OAuth callbacks.

| Group | Pages and behavior |
|---|---|
| Main | Overview, My Watchlist, Timeline, Change Intelligence, Risk Overview. Overview shows actionable items and routes to scan, search, changes and application progress. |
| Discover | Opportunity Radar, Page Discovery and Saved Opportunities. |
| Applications | Application Workspaces, Document Checklist, Dependency Planner and existing Backup Signup. |
| Intelligence | Ask Deadline Scout, Website Comparisons, Multi-Source Verification and Productivity Insights. |
| Collaboration | Shared Watchlists and role management. |
| Personal | Application Passport, Deadline Scout Memory and Calendar & Integrations. |
| Settings | Profile, Interests, Notifications, Privacy & Security and Connected Accounts, using existing controls where possible. |

Use stable opportunity detail links with Overview, Milestones, Changes, Sources, Checklist, Tasks, Notes and Workspace tabs. Reuse accessible dialog/toast patterns, support keyboard focus restoration, reduced motion and narrow screens. Start with existing pages and actual data. Each later navigation entry should ship with its working flow.

## 6. Backend module plan

- Keep the existing app and auth middleware. Introduce small route handlers and separate services for facts, verification and diffs around existing extractor and comparator seams. Version new response shapes without changing legacy clients.
- Split deterministic logic into functions suitable for isolated tests. Source readers return normalized evidence; the change service creates before/after facts, confidence and review state; risk and summaries consume those results. Avoid provider calls or large page comparisons while holding the cross-instance write lock. Budget per-read and per-tick work so signup and email are not starved.
- Workspace, checklist, tasks and passport services reuse existing track/draft identifiers and check ownership before reads or writes. Impact analysis proposes actions. Both it and the assistant must leave external changes to an explicit approved flow. Preserve existing verified Calendar/Tasks sync unless an explicit migration to a new policy is agreed.
- The assistant starts with a server-authorized read-only query over dates, approved facts and user-selected data. Assemble source references from stored record IDs. Use a provider for language assistance only where helpful, with validated responses, grounded snippets, rate limits and fallbacks. Keep private answers, PDF bytes, credentials and sensitive notes out of provider payloads by default.
- Feed discovery uses configured public sources, source attribution and user preferences. Apply the current URL guards, limits and canonicalization. Collaboration adds role-scoped reads and atomic invite acceptance before any shared UI is exposed.

## 7. Extension plan

- Keep the popup small. Reuse active-tab scanning for explicit discovery and offer tracking or dashboard review when the signal is useful. Add recent alerts through the existing scoped connection.
- For a tracked overlay, start with an explicit action or enabled per-site permission. Match the normalized current URL to approved source URLs and request only safe display fields through a narrowly scoped connection. Render one dismissible Shadow DOM overlay per document. Handle navigation and avoid restricted pages, broad background browsing collection and polling per tab.
- Preserve the worker alarms, signup session storage, site permissions, job receipts and permission prompts. Add tab/worker restart tests for any feature that depends on persistent browser state.

## 8. Implementation order

| Phase | Files and dependencies | Acceptance checks |
|---|---|---|
| 1 · Foundation | `server/app.js`, both stores and audit-backed migration files, existing dashboard assets and focused route tests. Add opportunity read projection, versioned change/source contracts and shell around working views. | Legacy records load unchanged. Old URLs, OAuth, alerts, watchlist mutations, modal review and Backup Signup work. |
| 2 · Intelligence | `engine.js`, source readers and new change/verification/diff/summary/risk services. Add bounded evidence history and controlled source fixtures. | Quiet formatting edits produce no changes; fee/eligibility/requirement edits show exact evidence; conflict requires review; accessible comparisons work on desktop/mobile. |
| 3 · Applications | New workspace/task services and views, wired to existing signup routes. | Owner isolation; task cycles rejected; readiness feeds risk; impact previews preserve linked records until approved in the new workflow. |
| 4 · Assistant and productivity | Read-only retrieval, history and memory controls, insights and heatmap. Depends on evidence and task contracts. | Cross-owner and private-data exclusion, traceable citations, unknown answers and model timeout behavior. |
| 5 · Discovery | Popup and worker integration, opted-in overlay and approved-source Radar. | No unsolicited collection, duplicate overlays or fabricated results. |
| 6 · Collaboration | Membership migrations and role-checked routes, then shared views. | Viewer/editor/owner permissions, invite replay and revocation, activity records, no exposure of private drafts. |
| 7 · Validation | Run full regression suite with responsive, keyboard, cross-browser, deployment and integration smoke checks. | Existing production behavior and extension compatibility verified. Deployment includes only reviewed changes. |

## 9. Main risks and compatibility decisions

- **Working tree.** Four local 1.9.16 extension files contain prior PDF diagnostics. Do not bundle them into expansion commits or treat them as a verified production fix.
- **Date correctness.** Confidence describes observation quality, not permission to replace a confirmed date. Keep source conflicts visible even if existing logic can resolve one explicitly updated source. Shared URLs repeating the same notice do not provide independent corroboration.
- **Load and storage.** Current cloud open loads the record set and serializes writes with a global lock. Large snapshots would magnify both costs. Keep bulk content out of normal workspace reads, cap retention, and test realistic concurrent checks before production.
- **Untrusted inputs.** Escape page text and treat it as evidence, including when supplied to a model. Guard fetched URLs, redirect chains and PDF parsing. Label scanned PDFs without usable text as unavailable until an OCR path is explicitly added.
- **Compatibility.** Support older extension clients and existing auth/session scopes. New modules must preserve removed-track notification cancellation and existing signup approval. Test local demo and real provider boundaries separately.
- **Verification.** A test fixture proves only its scenario. Include controlled tests for changed fees, eligibility, removed requirements, conflicting dates, JavaScript rendering and real failures. Check deployment and reload the extension separately when publishing implementation changes.

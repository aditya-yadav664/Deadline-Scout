# Deadline Scout expansion · Phase 4

## AI and productivity

- **Ask Deadline Scout** answers questions about upcoming dates, tracked changes, required checklist items, conflicting sources, and what needs attention. Answers link to the underlying opportunity and show source excerpts when available.
- **Gemini** optionally ranks the eligible evidence already found for a question. Enable it in the Vercel server environment with `GEMINI_API_KEY`. The optional `GEMINI_ASSISTANT_MODEL` overrides the model for this assistant. Each request requires the user to opt in. The server sends the question, verified source excerpts and associated facts. Draft answers, attachments, private notes, Passport, and Scout Memory stay in Deadline Scout. If Gemini is unavailable or cannot rank a result, the same workspace evidence remains available.
- **Scout Memory** lets users add, edit, and delete private notes. Each note shows who added it and when it was updated. Memory and the latest 15 assistant answers are encrypted in the existing owner-scoped store. Users can clear assistant history independently.
- **Deadline Heatmap** shows milestones, due tasks and recorded changes in a clickable monthly or weekly view, with opportunity, category and high-risk filters.
- **Productivity Insights** counts current opportunities, upcoming milestones, open tasks, completed checklist items, recently updated opportunities and high-risk items.
- **Backup Signup** loads on demand inside the dashboard shell. Existing extension handoffs, email links and bookmarked `/backup.html` URLs still open the compatible standalone editor.

## Next phases

1. **Phase 5 · Discovery.** Surface possible deadline sources from public links on a tracked page. Add an opt-in Opportunity Radar using approved sources and show the source, eligibility and match reason for every result. Add an on-page overlay showing the source-backed milestones found on the current tab.
2. **Phase 6 · Collaboration.** Add explicitly shared watchlists, enforce owner/editor/viewer permissions on the server, and add comments, task assignments and activity history.
3. **Phase 7 · Validation.** Verify responsive and keyboard behavior, benchmark dashboard and monitoring performance, test extension compatibility, and run full regression tests against previously saved data.

# Deadline Scout expansion · Phase 3

The dashboard uses a persistent, labelled desktop sidebar with workspace and application groups. Navigation rows highlight on hover and keyboard focus. On small screens the sidebar becomes a collapsible menu. The current workspace appears in the content header.

## Application tools

- Each saved opportunity has a private workspace for notes, priority, explicitly saved public pages and existing Backup Signup drafts. Resume application opens the tracked page. Other saved pages and drafts open separately from the workspace.
- The checklist supports custom required or optional items, notes, completion and document references. Users can import suggested requirements with the original source evidence. A document reference is a label. The checklist does not copy or validate a file.
- The dependency planner shows a task graph, an accessible task list and reasons for blocked tasks. Dates and related milestones are editable. The API rejects cycles and completion while prerequisites remain open.
- Risk Overview now considers saved priority, open tasks and incomplete required checklist items. Change impact identifies related task chains, linked Google records and existing drafts. It provides a review prompt and does not mutate task dates, modify external records, or change the existing Calendar and Tasks synchronization policy.
- The encrypted Application Passport stores explicitly saved education, skills, achievements, reusable answers and document references. Backup Signup lets the user apply one entry to one supported text field in a draft. Existing draft review and approval remain required.

## Storage and access

Application workspaces and encrypted Passport entries are new kinds in the existing owner-scoped store. There is no schema migration. Track removal clears its application workspace. Account-data clearing removes workspaces and Passport entries. A saved workspace link excludes URL credentials, fragments and query strings.

The application tests cover ownership, source requirement import, blocked tasks, cycle rejection, persistence, Passport storage and browser navigation. Run `node --test` for the full suite.

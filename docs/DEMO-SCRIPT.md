# 60-second Deadline Scout demo

## Prepare before recording

- Start the backend and load the Chrome extension.
- For a live demo, configure Supabase/Google and Brevo, sign in, enable Email alerts, and send one successful test email.
- Enable browser notifications. Ensure OS notifications are allowed.
- Set the demo source state to Original.
- Track only the closing milestone on the fictional registration, approve its FAQ source, confirm 28 November 2026, and plan signup for 27 November.
- With Google configured, create one Calendar event and one Task in advance. Keep those tabs and the recipient inbox ready.
- If live accounts are not configured, use the clearly labelled demo outbox. Say that Google actions need account configuration; do not present simulated Google writes.

## Script

| Time | Show | Say |
| --- | --- | --- |
| 0–8s | Registration page and side panel | “Registration schedules change after we make plans. Deadline Scout watches the actual milestones and the sources behind them.” |
| 8–16s | The saved card: 28 November, planned signup 27 November | “I tracked the registration deadline and approved its linked FAQ. My plan is to register on the 27th.” |
| 16–24s | Settings → apply Explicit update · 26 November; return to Watchlist | “Now the organizer moves the deadline forward in the FAQ.” |
| 24–34s | Check now, browser alert, Timeline | “The deadline moved from the 28th to the 26th. Here is the exact quote, the source, and the practical impact: my plan is one day too late.” |
| 34–42s | Real inbox, or clearly labelled demo activity | Live: “The backend also sent the change by email, even if Chrome was closed.” Demo: “This labelled local outbox shows the email without needing provider credentials.” |
| 42–52s | Approve Update Calendar event / Update Google Task and inspect existing entries | “Calendar and Tasks are separate. I approve the update, and the existing entries change instead of duplicating.” If Google is unconfigured, explain that live OAuth setup is required and show the approval UI only after configuring it. |
| 52–60s | Check again; then briefly show a conflicting-source state if time permits | “A second check creates no duplicate alert. If sources disagree, Deadline Scout keeps the confirmed date and pauses automatic Google updates.” |

Checks run on the backend every configured interval. “Check now” accelerates the recorded demonstration; it is not the only way to discover a change.

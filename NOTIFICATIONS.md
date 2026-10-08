# Notifications

Enough stores notifications for the account that owns the product. The current event sources are:

- CREDIT_EARNED: a completed task’s evidence was verified and its credit reward was issued.
- STAGE_CHANGED: the product owner changed the product’s stage.
- MARKET_SIGNAL: an authenticated integration recorded a customer reply, interview, demo, payment, or subscription event.
- TASK_REVIEW: an authenticated integration event was attached to a completed task and is waiting for owner review.

An authenticated webhook signature shows that the sender controls the configured source credentials. It does not establish that an event came directly from a vendor or independently prove a customer outcome. Linked task evidence stays pending until the product owner reviews it.

## Channels and pacing

- Web inbox: latest 50 records, with per-item and mark-all read actions. Turning off the web inbox hides those records in the UI; it does not remove them.
- Desktop: the Electron app polls about once per minute and acknowledges an alert after the operating system accepts it. Quiet hours defer alerts. The API caps delivery at 10 alerts per rolling hour, and the app spaces local alerts by at least 30 seconds.
- Email: opt-in only. The account needs a verified email address and configured Resend credentials. The worker retries delivery up to five times with backoff and uses a stable provider idempotency key. It caps delivery at three emails per rolling 24 hours.

Quiet hours use the saved IANA time zone and local HH:mm start/end values. The start is inclusive and the end is exclusive; ranges may cross midnight. Quiet hours defer desktop and email delivery. The web inbox remains available without interrupting the user.

Notification creation is capped at 100 per account per rolling 24 hours. Email delivery has no effect on web or desktop delivery. Browser push is not enabled.

Emails contain the notification title, short message, a link to the relevant Enough page, and a link to workspace notification settings. They do not include raw integration payloads, contact references, or task evidence contents.

## Setup and acceptance

Migration 0012_notifications.sql creates notification records and preferences. Run the normal migration runner through 0012 before using these routes. For email, configure RESEND_API_KEY, AUTH_EMAIL_FROM, and a verified account address. See IMPLEMENTATION_HANDOFF.md for the runtime and browser acceptance checklist.

# Enough — Complete Product Implementation Plan

> **Working name:** Enough  
> **Core promise:** Earn your next coding session by getting market signal.  
> **Primary principle:** Enough exists to interrupt product-building when market learning is being neglected. Every feature must strengthen detection, intervention, market action, evidence, or learning. If it does none of those five things, it does not belong in Enough.

---

# 1. Product Vision

Enough is a founder-focused anti-overbuilding platform.

It is designed for technical founders, indie hackers, solo builders, AI-assisted developers, and small product teams who spend too much time building and not enough time validating, selling, talking to users, distributing, or acquiring customers.

The product does not merely recommend that founders market more.

It actively measures building activity and can restrict access to configured building tools until the founder completes meaningful market-facing work.

The core behavioral loop is:

```text
BUILD
  ↓
Enough measures activity
  ↓
Is market signal keeping up?
  ├─ YES → continue building
  └─ NO  → restrict building
               ↓
          complete growth task
               ↓
          submit/verify evidence
               ↓
          earn build credit
               ↓
              BUILD
```

Enough treats excessive building itself as a possible productivity trap.

Traditional productivity tools assume:

```text
YouTube / Reddit / social media = distraction
VS Code / Cursor / terminal       = productive work
```

Enough understands that for a technical founder with no customers, the opposite can sometimes be true.

---

# 2. Product Composition

Enough is not a pure browser application.

The complete product consists of:

```text
Web Application
    +
Backend API
    +
Background Worker
    +
Desktop Agent
    +
Browser Extension
    +
Admin Console
```

The web application is the control center.

The desktop agent monitors and restricts native applications such as:

```text
Cursor
VS Code
Claude Code
Codex
Android Studio
IntelliJ
Terminal
GitHub Desktop
other configured tools
```

The browser extension monitors and restricts browser-based building environments such as:

```text
localhost
Replit
Lovable
Bolt
v0
GitHub
custom domains
```

---

# 3. Recommended Technology Stack

## 3.1 Web

```text
Next.js 16
React
TypeScript
Tailwind CSS
shadcn/ui or equivalent component primitives
TanStack Query
Zod
```

## 3.2 Backend

Recommended:

```text
Fastify
Node.js
TypeScript
Zod
PostgreSQL
Drizzle ORM
Redis
BullMQ
WebSocket
```

Alternative if desired:

```text
Next.js API layer for lightweight endpoints
+
separate Fastify service for activity ingestion and realtime workloads
```

For the final product, a dedicated backend service is preferable.

## 3.3 Desktop

```text
Tauri 2
Rust
TypeScript frontend
SQLite for encrypted/local cached state
```

## 3.4 Browser Extension

```text
TypeScript
Manifest V3
Chrome / Chromium
Edge
Brave
Firefox compatibility layer
```

## 3.5 Storage

```text
PostgreSQL
Redis
S3-compatible object storage
```

Object storage is required for:

```text
evidence screenshots
optional attachments
export archives
generated reports
```

## 3.6 External Services

```text
Stripe
Resend
PostHog
Sentry or OpenTelemetry-compatible monitoring
Google OAuth
Microsoft OAuth
```

---

# 4. Deployment Architecture

No Docker.

No GitHub Actions.

Deployment should use the same simple VPS-oriented approach used by many self-hosted production applications.

Recommended server:

```text
Ubuntu LTS VPS
Nginx
systemd
Node.js
PostgreSQL
Redis
pnpm
Rust toolchain where needed for release builds
```

Suggested production layout:

```text
/home/mignon/apps/enough/
├── current/
├── releases/
├── shared/
│   ├── .env
│   ├── uploads/
│   └── logs/
└── scripts/
```

Services:

```text
enough-web.service
enough-api.service
enough-worker.service
```

Optional:

```text
enough-scheduler.service
```

Nginx handles:

```text
TLS termination
reverse proxy
static files
rate limiting where appropriate
compression
security headers
```

Deployments are performed with shell scripts.

Example:

```text
git pull
pnpm install --frozen-lockfile
pnpm build
run migrations
restart systemd services
run health checks
```

A safer release-based deployment is preferable:

```text
releases/2026xxxxxx/
        ↓
build
        ↓
migrate
        ↓
health-check
        ↓
switch current symlink
        ↓
restart services
```

Rollback:

```text
switch current symlink to previous release
restart services
```

---

# 5. Monorepo Structure

```text
enough/
├── apps/
│   ├── web/
│   ├── api/
│   ├── worker/
│   ├── desktop/
│   ├── extension/
│   └── admin/
│
├── packages/
│   ├── db/
│   ├── contracts/
│   ├── auth/
│   ├── rules-engine/
│   ├── activity-engine/
│   ├── growth-engine/
│   ├── integrations/
│   ├── billing/
│   ├── ui/
│   └── shared/
│
├── infra/
│   ├── nginx/
│   ├── systemd/
│   ├── migrations/
│   ├── scripts/
│   └── monitoring/
│
├── docs/
│   ├── PRODUCT_SPEC.md
│   ├── ARCHITECTURE.md
│   ├── DOMAIN_MODEL.md
│   ├── RULE_ENGINE_SPEC.md
│   ├── PRIVACY_MODEL.md
│   ├── EVENT_SCHEMA.md
│   ├── THREAT_MODEL.md
│   └── IMPLEMENTATION_PLAN.md
│
└── package.json
```

---

# 6. Fundamental Product State Machine

```text
AVAILABLE
    ↓
BUILDING
    ↓
WARNING
    ↓
BUILD_LIMIT_REACHED
    ↓
GROWTH_REQUIRED
    ↓
GROWTH_ACTION_STARTED
    ↓
EVIDENCE_SUBMITTED
    ↓
EVIDENCE_VERIFIED
    ↓
BUILD_CREDIT_GRANTED
    ↓
AVAILABLE
```

Additional states:

```text
PAUSED
EMERGENCY_BYPASS
OFFLINE_ENFORCEMENT
INTEGRATION_ERROR
POLICY_DISABLED
```

The canonical state machine belongs in:

```text
packages/rules-engine
```

It must not be duplicated independently between web, desktop, and extension clients.

---

# 7. Core Domain Concepts

The terminology should remain stable from the beginning.

```text
Build Activity
Growth Activity
Market Signal
Build Credit
Growth Task
Evidence
Rule
Guard
Product Stage
Build Session
Growth Session
Build/Grow Score
Outcome
Device
Integration Event
```

---

# 8. Product Stages

Enough adapts recommended behavior based on product maturity.

Supported stages:

```text
IDEA
PROBLEM_VALIDATION
SOLUTION_VALIDATION
PRE_LAUNCH
LAUNCHED_ZERO_USERS
EARLY_USERS
FIRST_REVENUE
PRODUCT_MARKET_SIGNAL
GROWTH
```

## 8.1 Idea

Primary goals:

```text
problem research
prospect conversations
pain validation
competitive discovery
```

Building should be heavily discouraged.

## 8.2 Problem Validation

Reward:

```text
customer interviews
qualified outreach
problem confirmation
pre-commitments
waitlist commitments
```

## 8.3 Solution Validation

Reward:

```text
prototype tests
demo conversations
pre-orders
trial commitments
feedback
```

## 8.4 Pre-Launch

Reward:

```text
waitlist acquisition
beta recruitment
launch preparation
customer conversations
distribution setup
```

## 8.5 Launched / Zero Users

Strong intervention mode.

Prioritize:

```text
outreach
distribution
demo activity
onboarding
signups
user activation
conversion
```

## 8.6 Early Users

Balance:

```text
customer conversations
retention
activation
product improvements
sales
```

## 8.7 First Revenue

Build/grow balance becomes more flexible.

## 8.8 Product-Market Signal

Restrictions loosen further.

## 8.9 Growth

Product becomes primarily an accountability and resource-allocation system instead of a hard blocker.

---

# 9. Build Credits

Build Credits are one of the core mechanics.

The founder earns building time by completing meaningful market-facing actions.

Example defaults:

```text
5 targeted outreaches       → +30 minutes
1 genuine prospect reply    → +45 minutes
1 customer interview        → +90 minutes
1 product demo              → +120 minutes
1 activated user            → +120 minutes
1 paying customer           → +240 minutes
```

These values are configurable.

Credits must be product-specific.

Example:

```text
Product A: 90 available minutes
Product B: 180 available minutes
```

Do not store only a current balance.

Use an append-only ledger.

Example:

```text
+45 outreach verified
-30 build session
+90 customer interview
-60 build session
+240 customer payment
```

---

# 10. Build Credit Ledger

Table:

```text
build_credit_ledger
```

Fields:

```text
id
user_id
workspace_id
product_id
device_id
type
amount_minutes
source_type
source_id
description
created_at
expires_at
metadata
```

Types:

```text
EARN
SPEND
RESERVE
RELEASE
REFUND
EXPIRE
MANUAL_ADJUSTMENT
SYSTEM_ADJUSTMENT
```

Important requirement:

Build credits must not double-spend across devices.

Use transactional locking or an atomic reservation mechanism.

---

# 11. Build/Grow Score

The product should expose a simple founder balance score.

Example:

```text
THIS WEEK

Building               18h 43m
Growth                   3h 12m
Customer conversations        2
Targeted outreach            19
Replies                       4
Demos                         1
New users                     3
Paying customers              0
Revenue                      €0

BUILD / GROW
85 / 15

STATUS
OVERBUILDING
```

The score should consider:

```text
time
verified actions
market outcomes
product stage
recent trend
```

The score must not be a simplistic time ratio.

A payment or activated customer should be more valuable than several hours of generic marketing activity.

---

# 12. Growth Signal Classification

Not every "marketing" activity is meaningful.

Enough should classify activity by signal strength.

## 12.1 Strong Signal

```text
customer interview
prospect reply
demo
trial activation
signup
pre-order
payment
cancellation feedback
retention conversation
```

## 12.2 Medium Signal

```text
personalized outreach
community conversation
direct product recommendation
landing-page experiment
launch activity
```

## 12.3 Weak Signal

```text
generic social post
SEO article
newsletter
analytics review
content publishing
```

## 12.4 Pseudo-Work

```text
changing logo
rewriting homepage endlessly
checking analytics repeatedly
scheduling excessive social content
researching another framework
reorganizing project tools
```

Enough should actively teach the difference between activity and signal.

---

# 13. Enforcement Modes

## 13.1 Observe

No blocking.

Only measurement and reports.

## 13.2 Nudge

Warnings and recommendations.

## 13.3 Guard

Build tools become unavailable when a rule is triggered.

## 13.4 Hard Mode

Configured building applications and domains remain blocked until a growth requirement is completed.

## 13.5 Founder Mode

Maximum accountability.

Example:

```text
Users: 0
Customer conversations this week: 0
Build time: 16h 21m

Your problem is not code.

Complete:
Talk to 3 potential users

to unlock another build session.
```

---

# 14. Safe Blocking Behavior

Enough must never behave like malicious software.

Never abruptly terminate an editor.

Grace period:

```text
10 minutes remaining
5 minutes remaining
1 minute remaining
```

Then:

```text
Build period finished.

Please save your work.

[Save & enter Growth Mode]
```

After the grace period, new launches of restricted tools can be blocked.

Always provide an emergency exit.

Example:

```text
Emergency unlock

Reason:
____________________

Unlock after delay.

This bypass will appear in your weekly report.
```

---

# 15. Desktop Agent

The desktop client runs mainly in the system tray.

Responsibilities:

```text
active application detection
foreground duration tracking
idle detection
application classification
build-session tracking
local policy enforcement
desktop notifications
offline policy cache
encrypted local data
background synchronization
startup launch
auto-update
```

Initial detection:

```text
Detected tools:

Cursor
VS Code
GitHub Desktop
Docker Desktop
Claude
IntelliJ
Android Studio
Terminal
```

The user chooses which tools count as building.

The product does not require access to source code.

---

# 16. Desktop Privacy Model

Default behavior must never capture:

```text
keystrokes
source code
clipboard
screen contents
document contents
passwords
email content
terminal command contents
```

Default telemetry:

```text
application identifier
application category
start timestamp
end timestamp
duration
idle state
product mapping
```

Optional advanced matching may use:

```text
window title
folder identifier
project identifier
```

but should preferably be processed locally.

---

# 17. Browser Extension

Initial targets:

```text
Chrome
Edge
Brave
Firefox
```

Responsibilities:

```text
authentication
policy synchronization
domain activity tracking
dynamic blocking
redirect page
Growth Mode allowlist
offline cache
native agent communication
health status
tamper detection
```

Example restricted domains:

```text
replit.com
lovable.dev
bolt.new
v0.dev
github.com
localhost
custom development environments
```

---

# 18. Block Page

Example:

```text
YOU'VE BUILT ENOUGH.

18h 43m building this week
1 customer conversation
0 paying customers

Your next task:

Contact 5 prospective users.

Progress:
0 / 5

Reward:
45 build minutes

[Start Growth Session]
```

---

# 19. Growth Sessions

Growth Sessions provide a temporary context where market-facing tools are allowed.

Potential allowlist:

```text
Gmail
Outlook
LinkedIn
X
Reddit
CRM
Calendar
analytics tools
product website
support tools
```

Restricted:

```text
Cursor
VS Code
Claude Code
Codex
localhost
Replit
Lovable
```

Context matters.

A site can be:

```text
distraction during Build Mode
legitimate channel during Growth Mode
```

---

# 20. Growth Task Engine

The system must never simply say:

```text
Do marketing.
```

It must generate actionable tasks.

Example:

```text
PRODUCT
Example SaaS

STAGE
Launched / zero customers

TASK
Find 5 companies matching your ideal customer profile.

Send each a personal message asking whether they currently experience the problem your product solves.

GOAL
5 messages

REWARD
45 build minutes
```

Task categories:

```text
VALIDATION
OUTREACH
INTERVIEW
DEMO
DISTRIBUTION
ACTIVATION
CONVERSION
RETENTION
MONETIZATION
RESEARCH
```

---

# 21. Growth Task Templates

Each template contains:

```text
name
category
description
instructions
recommended_stages
minimum_requirement
default_credit
signal_strength
verification_method
difficulty
estimated_duration
```

Users can create custom templates.

Enough can also generate personalized tasks.

---

# 22. Feature Gate

Another signature feature.

Before starting a major feature, the founder can create:

```text
NEW FEATURE

Team analytics dashboard
```

Enough asks:

```text
Why are you building it?

Customer requested it
Multiple users requested it
Sales blocker
Retention problem
Experiment
Internal idea
I think we need it
```

Then:

```text
What evidence supports it?
```

Evidence types:

```text
customer quote
support request
conversation
analytics
revenue opportunity
manual explanation
```

Enough recommends:

```text
BUILD
VALIDATE_FIRST
BACKLOG
DELETE
```

Hard Mode may optionally require evidence before major feature work is unlocked.

---

# 23. Evidence System

Three verification levels.

## 23.1 Self-Reported

Example:

```text
I contacted 5 prospects.
```

## 23.2 User-Submitted Evidence

```text
URL
note
screenshot
attachment
meeting reference
manual proof
```

## 23.3 Integration-Verified

Examples:

```text
calendar interview completed
email outreach sent
prospect replied
Stripe payment received
user activated
signup received
```

Evidence states:

```text
PENDING
SELF_VERIFIED
AUTOMATICALLY_VERIFIED
MANUALLY_VERIFIED
REJECTED
EXPIRED
```

---

# 24. Integration Architecture

All integrations use a common abstraction.

Example:

```text
IntegrationProvider
connect()
disconnect()
refresh()
sync()
verifyEvent()
getHealth()
```

Integration tables:

```text
integration_accounts
integration_tokens
integration_events
integration_sync_runs
integration_errors
```

Tokens must be encrypted at rest.

---

# 25. Email Integrations

Initial providers:

```text
Gmail
Microsoft Outlook
```

Potential verified events:

```text
outreach sent
prospect reply received
conversation continued
qualified response received
```

Do not reward raw email volume.

Anti-spam logic should consider:

```text
unique recipients
manual personalization
reply rate
daily limits
duplicate recipients
```

---

# 26. Calendar Integrations

Initial providers:

```text
Google Calendar
Microsoft Calendar
```

Recognized configured event categories:

```text
customer interview
demo
sales call
onboarding
feedback call
retention call
```

Calendar presence alone should not automatically prove success.

Completion time and optional user confirmation may be required.

---

# 27. Revenue Integration

Initial provider:

```text
Stripe
```

Important events:

```text
checkout.session.completed
payment_intent.succeeded
customer.subscription.created
invoice.paid
customer.subscription.deleted
charge.refunded
```

Revenue events should carry strong signal weight.

---

# 28. Product Analytics Integrations

Support:

```text
PostHog
Plausible
GA4
generic webhook
public API
```

Important events:

```text
user.signup
user.activated
trial.started
conversion.completed
user.retained
user.churned
```

---

# 29. Public Event API

Example:

```http
POST /v1/events
```

Payload:

```json
{
  "event": "customer.activated",
  "product_id": "product_x",
  "user_reference": "anonymous_or_external_id",
  "timestamp": "2026-10-06T12:00:00Z",
  "metadata": {}
}
```

Requirements:

```text
API keys
rate limiting
idempotency keys
signature verification
event validation
event replay protection
audit logs
```

---

# 30. AI Growth Coach

AI is an advisory layer.

It must not directly control blocking.

Inputs:

```text
product description
target customer
product stage
business model
recent build activity
recent growth activity
current goals
market outcomes
historical effectiveness
```

AI responsibilities:

```text
next-action recommendation
growth-task generation
scope challenge
weekly diagnosis
overbuilding explanation
feature challenge
evidence classification assistance
```

Architecture:

```text
AI recommendation
      ↓
structured output
      ↓
deterministic validation
      ↓
rule engine
      ↓
enforcement
```

---

# 31. AI Guardrails

AI must never be able to:

```text
directly lock an application
directly deduct credits
directly approve payment events
directly bypass policies
directly alter billing
```

AI outputs are recommendations or structured proposals.

The deterministic system decides final state.

---

# 32. Main Dashboard

Primary top section:

```text
ENOUGH

Build balance        72 / 28
Status               Overbuilding
Build credit         47 minutes

Next action:

Talk to 2 potential customers

[Start Growth Session]
```

Sections:

```text
Today
Build activity
Growth activity
Market signal
Current task
Build credit
Recent outcomes
Trend
```

---

# 33. Activity Dashboard

Show:

```text
application
category
duration
product
session
date
```

Views:

```text
today
7 days
30 days
90 days
custom
```

Charts:

```text
Build vs Grow
Build time by tool
Growth activity by category
Market signal trend
```

---

# 34. Product Dashboard

Each product has:

```text
name
description
target customer
stage
business model
website
current metrics
build/grow target
rules
tools
growth goals
integrations
build credits
```

---

# 35. Multi-Product Support

A founder can run several products.

Each product receives independent:

```text
stage
rules
credits
metrics
tools
growth tasks
integrations
reports
```

Desktop mapping can associate work with a product.

Possible local matching:

```text
application + window title
folder identifier
localhost port
domain
manual active product
```

Privacy-sensitive mapping should happen locally where possible.

---

# 36. Local-First Enforcement

The desktop agent must continue working when the server is unavailable.

Local cache:

```text
current rules
current lock state
remaining credit
active sessions
recent activity
pending uploads
policy version
```

Each server policy includes:

```text
version
issued_at
expires_at
signature
```

When connectivity returns:

```text
local pending events
        ↓
upload
        ↓
deduplicate
        ↓
canonical server calculation
        ↓
state reconciliation
```

---

# 37. Core Database Tables

## Authentication

```text
users
accounts
sessions
devices
email_verifications
password_resets
```

## Organization

```text
workspaces
workspace_members
```

## Products

```text
products
product_stage_history
product_goals
product_metrics
```

## Tools

```text
tools
product_tools
tool_classifications
```

## Activity

```text
activity_events
activity_sessions
daily_activity_aggregates
```

## Growth

```text
growth_tasks
growth_task_templates
growth_task_assignments
growth_events
outcome_events
```

## Evidence

```text
evidence
evidence_files
evidence_verifications
```

## Rules

```text
rules
rule_conditions
rule_actions
rule_versions
lock_states
lock_events
emergency_unlocks
```

## Build Credit

```text
build_credit_ledger
build_sessions
growth_sessions
```

## Integrations

```text
integration_accounts
integration_tokens
integration_events
integration_sync_runs
integration_errors
```

## Product Operations

```text
notifications
subscriptions
billing_events
audit_logs
feature_flags
```

---

# 38. Activity Event Model

Event types:

```text
APP_OPENED
APP_CLOSED
APP_FOCUSED
APP_UNFOCUSED
DOMAIN_VISITED
DOMAIN_LEFT
BUILD_SESSION_STARTED
BUILD_SESSION_ENDED
GROWTH_SESSION_STARTED
GROWTH_SESSION_ENDED
SYSTEM_IDLE
SYSTEM_ACTIVE
LOCK_TRIGGERED
LOCK_RELEASED
```

Each event:

```text
id
event_id
user_id
device_id
product_id
type
occurred_at
received_at
duration
metadata
sequence
```

Requirements:

```text
idempotency
deduplication
clock-skew handling
out-of-order handling
batch ingestion
offline upload
```

---

# 39. Rules Engine

Conditions:

```text
build_minutes > X
growth_minutes < X
build_grow_ratio > X
customer_conversations < X
outreach_count < X
revenue = 0
new_users = 0
product.stage = X
build_credit <= X
days_without_signal > X
```

Actions:

```text
WARN
LIMIT_SESSION
BLOCK_BUILD
REQUIRE_TASK
GRANT_CREDIT
REDUCE_CREDIT
PAUSE_POLICY
REQUIRE_EVIDENCE
```

Rules contain:

```text
priority
enabled
version
scope
timezone
schedule
conditions
actions
effective_from
effective_until
```

Rules must be deterministic.

---

# 40. Notifications

Channels:

```text
web
desktop
email
optional push later
```

Examples:

```text
10 build minutes remaining.

You crossed your weekly build/grow threshold.

That customer conversation earned 90 build minutes.

You have received no new market signal for 7 days.

Build access is available again.
```

Avoid excessive gamification.

---

# 41. Reports

## Daily Report

```text
Built: 3h 21m
Growth: 1h 03m
Prospects contacted: 3
Replies: 1
Customer conversations: 0
New users: 0
Revenue: €0
```

## Weekly Founder Review

```text
BUILD/GROW
67 / 33

Most valuable action:
Customer demo

Least valuable pattern:
7 hours of product work without new market signal

Recommendation:
Interview the three active users before adding another feature.
```

Reports should include:

```text
Build vs Grow
market signals
credit earned
credit spent
outreach → reply
demo → signup
signup → customer
stage progression
```

---

# 42. Billing

Implement an entitlement system.

Never scatter direct subscription checks across the product.

Potential plans:

```text
Free
Pro
Founder+
```

Possible entitlements:

```text
activity history
number of products
hard blocking
AI recommendations
advanced rules
integrations
API access
webhooks
reports
devices
```

Stripe features:

```text
Checkout
Customer Portal
subscriptions
trials
coupons
VAT handling
invoices
webhook reconciliation
grace periods
failed-payment handling
```

Do not finalize pricing before real willingness-to-pay validation.

---

# 43. Privacy

Privacy is a major product feature.

Default promise:

```text
We track where you build, not what you build.
```

Do not collect by default:

```text
source code
keystrokes
clipboard
screen recordings
document contents
email bodies
passwords
terminal commands
```

Store only required metadata.

Allow users to inspect exactly what activity was collected.

---

# 44. GDPR

Required:

```text
privacy policy
data processing records
consent handling
data export
account deletion
data retention controls
OAuth revocation
device revocation
evidence deletion
subprocessor documentation
```

User deletion workflow must remove or anonymize all personally identifiable records according to retention obligations.

---

# 45. Security

Implement:

```text
secure cookies
CSRF protection
XSS protection
SQL injection protection
strict input validation
rate limiting
OAuth state/PKCE
token encryption
webhook signatures
replay protection
device authentication
extension message validation
desktop API authentication
audit logs
```

Security review categories:

```text
OWASP
SSRF
CSRF
XSS
SQL injection
OAuth attacks
webhook replay
token leakage
extension/native messaging abuse
privilege escalation
```

---

# 46. Anti-Cheating and Tamper Handling

Enough is a commitment device, not DRM.

Handle:

```text
clock manipulation
duplicate events
multiple devices
extension disabled
desktop agent stopped
offline abuse
renamed processes
stale policy
revoked integrations
fake task completion
```

Do not attempt invasive anti-tamper mechanisms.

If the user truly wants to bypass Enough, they can uninstall it.

The goal is behavioral friction, not hostile control.

---

# 47. Admin Console

Private administration interface.

Features:

```text
users
subscriptions
devices
integration health
failed background jobs
growth templates
rule templates
feature flags
AI usage
system health
support actions
audit events
manual account unlock
```

All privileged admin actions must be audited.

---

# 48. Testing Strategy

Required test layers:

```text
unit tests
integration tests
API contract tests
database tests
rules-engine tests
property-based tests
desktop tests
extension tests
end-to-end tests
offline tests
multi-device tests
billing tests
OAuth tests
migration tests
load tests
security tests
```

Critical scenarios:

```text
lock activates at correct threshold
unlock propagates immediately
credits cannot double-spend
emergency bypass always works
offline policy remains valid
state reconciles after reconnect
duplicate integration events do not duplicate credits
unsaved work is never intentionally destroyed
```

---

# 49. Observability

Implement:

```text
structured logs
service health checks
error tracking
background-job monitoring
database health
Redis health
integration sync health
webhook failure visibility
desktop version reporting
extension version reporting
```

Important metrics:

```text
API latency
activity ingestion rate
failed activity batches
rule evaluation failures
lock/unlock latency
credit reconciliation failures
integration failures
worker queue depth
email delivery failures
billing webhook failures
```

---

# 50. Production Backup Strategy

PostgreSQL:

```text
daily encrypted backups
retention policy
off-server copy
restore verification
```

Object storage:

```text
versioning where supported
retention
backup or replication
```

Critical requirement:

A backup is not considered valid until restore testing has been performed.

---

# 51. systemd Services

Example services:

```text
enough-web.service
enough-api.service
enough-worker.service
```

Each service must include:

```text
Restart=always
RestartSec=5
EnvironmentFile=/home/mignon/apps/enough/shared/.env
WorkingDirectory=/home/mignon/apps/enough/current/...
```

Optional timer/service units:

```text
enough-maintenance.timer
enough-report.timer
enough-cleanup.timer
```

Use systemd timers instead of cron where practical.

---

# 52. Nginx

Nginx responsibilities:

```text
TLS
reverse proxy
HTTP/2 or HTTP/3 where supported
gzip/brotli if available
security headers
upload size limits
API request limits
static caching
WebSocket forwarding
```

Suggested domains:

```text
enough.example.com
api.enough.example.com
admin.enough.example.com
```

or single-domain routing:

```text
/app
/api
/admin
```

---

# 53. Manual Deployment Scripts

Create:

```text
scripts/deploy.sh
scripts/rollback.sh
scripts/verify.sh
scripts/backup.sh
scripts/restore-test.sh
```

`deploy.sh` should:

```text
1. fetch latest approved revision
2. create release directory
3. install dependencies
4. build packages
5. run automated tests
6. run database migration prechecks
7. run migrations
8. update current symlink
9. restart systemd services
10. run health checks
11. verify workers
12. verify API
13. verify web
14. verify database connectivity
```

If validation fails:

```text
rollback
```

---

# 54. Release Safety

Before every production deployment:

```text
tests pass
migration plan reviewed
backup created
health endpoints working
current version recorded
rollback target known
```

After deployment:

```text
web health
API health
worker health
Redis
Postgres
background queue
email delivery
integration sync
activity ingestion
```

---

# 55. Implementation Phases

---

## Phase 0 — Product Contract and Scope Freeze

Create:

```text
PRODUCT_SPEC.md
ARCHITECTURE.md
DOMAIN_MODEL.md
RULE_ENGINE_SPEC.md
PRIVACY_MODEL.md
EVENT_SCHEMA.md
THREAT_MODEL.md
IMPLEMENTATION_PLAN.md
```

Define all core terminology.

Explicitly list out-of-scope product areas.

Exit criteria:

```text
all core concepts defined
architecture agreed
state machine agreed
privacy boundaries agreed
product terminology frozen
```

---

## Phase 1 — Repository and Core Foundation

Create monorepo.

Implement:

```text
TypeScript configuration
linting
formatting
testing
shared packages
environment validation
PostgreSQL
Redis
database migrations
local development scripts
systemd templates
Nginx templates
```

No Docker.

No GitHub Actions.

Exit:

```text
web starts
API starts
worker starts
database connects
Redis connects
health endpoints work
```

---

## Phase 2 — Authentication, Users, Sessions, Devices

Implement:

```text
email/password
passwordless option
Google login
GitHub login
passkeys if practical
email verification
password reset
session management
device registration
session revocation
device revocation
account deletion
data export
```

Security:

```text
secure cookies
CSRF
rate limiting
session rotation
audit events
```

Exit:

```text
web authenticates
desktop authenticates
extension authenticates
device sessions can be revoked
```

---

## Phase 3 — Product Onboarding

Complete onboarding wizard:

```text
What are you building?
Who is it for?
What problem does it solve?
What stage are you at?
Have you launched?
How many users?
How many paying users?
Current revenue?
What is your next goal?
Which tools do you use to build?
```

Generate initial recommended configuration.

Exit:

A new founder reaches a usable configured dashboard without manually creating policies.

---

## Phase 4 — Product and Stage Engine

Implement:

```text
products
product stages
stage history
goals
metrics
recommended ratios
stage-specific task recommendations
```

Exit:

Different stages produce meaningfully different guidance and rules.

---

## Phase 5 — Activity Event Platform

Implement:

```text
POST /activity/events
POST /activity/batch
```

Handle:

```text
deduplication
event ordering
clock skew
batch uploads
offline events
aggregation
idempotency
```

Exit:

Activity ingestion is reliable and scalable.

---

## Phase 6 — Tool Classification Engine

Implement default tool catalog.

Support:

```text
BUILD
GROWTH
NEUTRAL
CONTEXTUAL
BLOCKED
ALLOWED
```

Allow:

```text
custom apps
custom domains
product-specific mappings
context-dependent classifications
```

Exit:

Every tracked application/domain maps predictably.

---

## Phase 7 — Rule Engine

Implement:

```text
conditions
actions
priorities
schedules
product scopes
device scopes
versions
overrides
```

Build deterministic tests.

Exit:

Identical inputs always produce identical enforcement decisions.

---

## Phase 8 — Build Credit Engine

Implement:

```text
earn
spend
reserve
release
refund
expire
adjust
```

Add atomic multi-device safety.

Exit:

Credits cannot double-spend.

---

## Phase 9 — Web Application

Implement:

```text
Home
Products
Today
Activity
Growth
Tasks
Evidence
Rules
Integrations
Reports
Devices
Billing
Settings
```

Requirements:

```text
responsive
dark/light/system
keyboard accessible
loading states
empty states
error states
permission states
```

Exit:

All user-facing configuration is available through the web UI.

---

## Phase 10 — Browser Extension

Implement:

```text
authentication
domain tracking
policy sync
blocking rules
redirect page
Growth Mode
offline cache
native communication
health state
```

Exit:

Web development tools can be reliably controlled.

---

## Phase 11 — Desktop Agent

Implement:

```text
tray
autostart
active application detection
idle detection
session timer
classification
local cache
lock handling
notifications
grace period
emergency bypass
sync
auto-update
```

Platforms:

```text
Windows
macOS
Linux
```

Exit:

Configured native building applications can be reliably monitored and guarded.

---

## Phase 12 — Growth Task Engine

Implement:

```text
task templates
custom tasks
recurring tasks
stage recommendations
credit rewards
signal strength
task priority
estimated duration
```

Exit:

Every intervention produces a concrete next action.

---

## Phase 13 — Evidence System

Implement:

```text
self-report
notes
URLs
uploads
screenshots
integration evidence
manual verification
```

Exit:

Verified task completion can securely create credits.

---

## Phase 14 — Integrations

Implement architecture first.

Then:

```text
Gmail
Google Calendar
Outlook
Microsoft Calendar
Stripe
PostHog
Plausible
GA4
generic webhook
public API
```

Exit:

Meaningful real-world events can be verified automatically.

---

## Phase 15 — AI Layer

Implement:

```text
onboarding analysis
task generation
scope challenge
weekly diagnosis
next action
overbuilding explanation
evidence classification assistance
```

AI never controls enforcement directly.

Exit:

AI adds useful recommendations without becoming a correctness dependency.

---

## Phase 16 — Reports

Implement:

```text
daily report
weekly founder review
Build/Grow trend
signal trend
credit trend
conversion funnels
stage progression
```

Exit:

The founder can understand whether behavior is improving.

---

## Phase 17 — Notifications

Implement:

```text
web notifications
desktop notifications
email notifications
notification preferences
quiet hours
rate limits
```

Exit:

Critical events reach the user without creating notification fatigue.

---

## Phase 18 — Billing

Implement:

```text
Stripe Checkout
Customer Portal
subscriptions
trials
coupons
VAT
invoices
webhook reconciliation
entitlements
grace periods
failed payments
```

Exit:

Paid features are controlled by a centralized entitlement layer.

---

## Phase 19 — Privacy and GDPR

Implement:

```text
privacy dashboard
data export
account deletion
data retention
OAuth disconnect
device revoke
evidence deletion
consent management
audit history
```

Exit:

Privacy obligations are testable and complete.

---

## Phase 20 — Security Hardening

Perform:

```text
OWASP review
OAuth review
webhook review
native messaging review
desktop API review
extension security review
token protection
rate-limit testing
privilege review
```

Exit:

No known critical or high-severity security issue remains.

---

## Phase 21 — Anti-Tamper and Edge Cases

Handle:

```text
offline state
clock changes
duplicate events
multiple devices
disabled extension
killed desktop agent
renamed process
stale policy
revoked integration
fake completion
```

Exit:

Behavior remains predictable under non-ideal conditions.

---

## Phase 22 — Admin Console

Implement:

```text
users
subscriptions
devices
integrations
failed jobs
rule templates
growth templates
feature flags
AI usage
system health
support tools
audit logs
```

Exit:

Operational support does not require direct database editing.

---

## Phase 23 — Quality Engineering

Complete:

```text
unit
integration
contract
rules property testing
desktop
extension
E2E
offline
multi-device
billing
OAuth
migration
load
security
```

Exit:

All critical paths have automated regression coverage.

---

## Phase 24 — Installers and Distribution

Desktop releases:

```text
Windows installer
macOS installer
Linux AppImage
Linux deb
```

Extension stores:

```text
Chrome Web Store
Microsoft Edge Add-ons
Firefox Add-ons
```

Add desktop auto-update.

Exit:

Normal users can install and update without manual technical steps.

---

## Phase 25 — Production Infrastructure

Configure:

```text
Ubuntu
Node
pnpm
PostgreSQL
Redis
Nginx
systemd
TLS
backups
monitoring
logging
release scripts
rollback scripts
```

No containers.

Exit:

Production services survive reboot and restart automatically.

---

## Phase 26 — Production Verification

Verify:

```text
web
API
worker
Postgres
Redis
Nginx
TLS
email
billing webhooks
OAuth callbacks
integration sync
activity ingestion
desktop sync
extension sync
lock propagation
unlock propagation
background jobs
backups
restore
```

Exit:

All services work together in production.

---

## Phase 27 — Full Product Launch Gate

The product is not considered complete until all critical capabilities operate together.

Required:

```text
onboarding
products/stages
activity detection
tool classification
Build Credits
rules engine
browser blocking
native desktop blocking
growth tasks
evidence
Gmail
Outlook
Google Calendar
Microsoft Calendar
Stripe
generic webhook/API
AI coach
reports
multi-device
offline enforcement
emergency unlock
billing
privacy/export/delete
admin
installers
auto-update
monitoring
backups
automated tests
```

---

# 56. Explicitly Out of Scope

Do not build:

```text
public social network
internal CRM
email campaign platform
social scheduler
landing-page builder
website builder
code editor
source-code analyzer
Jira replacement
Slack replacement
general project-management suite
AI content factory
```

Integrate with external tools instead.

---

# 57. Product Design Principles

## Principle 1

Enough is not a generic productivity tool.

## Principle 2

Enough does not punish building.

It corrects unhealthy imbalance.

## Principle 3

Market signal matters more than marketing activity.

## Principle 4

Blocking decisions are deterministic.

## Principle 5

AI advises; rules enforce.

## Principle 6

Privacy defaults must be conservative.

## Principle 7

The user must always have an emergency exit.

## Principle 8

The system must function offline.

## Principle 9

The product itself must resist overbuilding.

## Principle 10

If a feature does not improve detection, intervention, action, evidence, or learning, it probably does not belong.

---

# 58. Core Product Loop

```text
        BUILD
          │
          ▼
   Enough measures it
          │
          ▼
 Is market signal keeping up?
       /       \
     YES        NO
      │          │
      ▼          ▼
 Continue      BUILD LOCK
                   │
                   ▼
             GET SIGNAL
                   │
       ┌───────────┼───────────┐
       ▼           ▼           ▼
    Outreach     Talk        Sell
       │           │           │
       └───────────┼───────────┘
                   ▼
             SIGNAL VERIFIED
                   │
                   ▼
            BUILD CREDIT
                   │
                   ▼
                 BUILD
```

---

# 59. Signature User Experience

The product should ultimately be able to show this screen:

```text
You've built enough.

17h 42m building
48m talking to customers
0 new customers

Your next feature can wait.

Contact 5 potential users
to unlock your next coding session.

Progress:
0 / 5

Reward:
60 build minutes

[Start Growth Session]
```

That is the essence of Enough.

---

# 60. Final Implementation Rule

Every implementation phase must update the project handoff documentation.

At minimum maintain:

```text
IMPLEMENTATION_HANDOFF.md
IMPLEMENTATION_PLAN.md
SECURITY_STATUS.md
DEPLOYMENT_STATUS.md
KNOWN_LIMITATIONS.md
```

Every completed phase should record:

```text
implemented functionality
database changes
API changes
tests added
manual checks required
known limitations
deployment notes
remaining blockers
```

The product should never rely on undocumented implementation knowledge.

---

# Final Definition

Enough is a behavioral operating system for builders.

It observes the balance between product creation and market learning.

When a founder spends too much time building without enough evidence from customers, Enough intervenes.

It does not need the source code.

It does not need to know what was written.

It only needs to understand:

```text
how much you are building
how much you are learning from the market
whether the market is responding
whether another coding session is actually justified
```

The final promise remains:

> **Earn your next coding session by getting market signal.**

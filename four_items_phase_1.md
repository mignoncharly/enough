The current Windows environment has intermittent EPERM filesystem/package-manager failures.

Do not waste time repeatedly fighting Windows-specific package locking.

If the native Windows environment remains unreliable, use WSL2 with Ubuntu as the supported development environment.

Do not introduce Docker.

Do not introduce GitHub Actions.

Do not require or touch a production server.

Phase 1 must be completed entirely in the local development environment.

1. Establish a reliable Linux development environment

Prefer WSL2 Ubuntu if Windows package access remains unreliable.

Verify:

uname -a
node --version
pnpm --version
git --version
psql --version
redis-server --version

Use the Node.js version required by the repository.

If the repository defines the version in any of:

.nvmrc
.node-version
package.json engines
pnpm-workspace.yaml

respect that version.

Do not silently upgrade dependencies merely because newer versions exist.

Use the project's existing package manager and lockfile.

For pnpm:

corepack enable
pnpm --version
pnpm install --frozen-lockfile

The install must complete reliably.

Do not delete or regenerate the lockfile unless it is demonstrably invalid and the reason is documented.

2. Avoid problematic Windows-mounted paths

If running under WSL2, do not execute the Node dependency installation from /mnt/c/... if that causes filesystem or permission issues.

Prefer a Linux-native working directory such as:

~/projects/enough

Clone or copy the repository there safely.

Do not create divergent source histories.

Confirm:

git status
git remote -v
git branch --show-current

before continuing.

3. Secret and repository hygiene review

Before making the initial Git snapshot, inspect the entire repository for accidental secrets or machine-specific files.

Check for:

.env
.env.*
API keys
OAuth secrets
database passwords
Redis passwords
private keys
certificates
tokens
credentials
personal absolute paths
build artifacts
node_modules
temporary files
logs
SQLite/local runtime state
IDE files that should not be committed

Verify .gitignore.

Provide tracked templates where appropriate:

.env.example

Templates must contain only placeholder values.

Search tracked files for suspicious values using appropriate repository-safe commands.

Do not print real secrets into terminal output or documentation.

If a real credential is discovered:

remove it from tracked source

document that rotation is required

do not commit it

do not attempt to hide the discovery

4. PostgreSQL

Use an isolated local PostgreSQL database for Enough.

Do not reuse an unrelated application database.

Create or verify:

database
application role
development credentials
test database if the repository expects one

Use the project's existing environment variable naming.

Example only:

DATABASE_URL
TEST_DATABASE_URL

Do not introduce duplicate configuration names if the project already has equivalents.

Confirm connectivity using both:

psql

and the application database layer.

5. Redis

The previously available Redis 3 installation is unsupported for this project.

Install a currently supported Redis release from the Ubuntu environment/package source appropriate for the selected Ubuntu release.

Do not continue using Redis 3.

Verify:

redis-server --version
redis-cli ping

Expected connectivity check:

PONG

Use an isolated Enough Redis namespace/database where supported by the existing configuration.

Do not expose Redis publicly.

For local development it should bind only to the local environment.

6. Environment configuration

Prepare the local development .env from the repository template.

Use only local development credentials.

Verify configuration validation.

The application must fail clearly on missing required configuration rather than silently starting in a broken state.

Do not weaken environment validation simply to make startup easier.

7. Dependency installation

Once package access is reliable:

pnpm install --frozen-lockfile

Then run repository-provided formatting commands.

If the workspace exposes scripts, use those scripts rather than inventing parallel commands.

Typical sequence:

pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build

Adapt only to scripts that actually exist.

If formatting changes are required, run the project's formatter and re-run the check.

Do not claim success based on an older run.

Every verification must be performed against the latest working tree.

8. Database migrations

Inspect the migration history before running anything.

Then apply migrations against the isolated Enough database.

Verify:

all expected migrations apply in order

schema state matches source expectations

migrations are idempotently tracked

no unrelated database is touched

If the project has migration verification/status commands, run them.

Also verify that a fresh empty database can be migrated successfully from zero.

Do not modify historical migrations casually.

If a migration is genuinely broken, explain why before repairing it.

9. Runtime acceptance

Start the local services required by Phase 1:

web
API
worker
PostgreSQL
Redis

Desktop and extension build verification should also remain passing, but they do not need to run continuously for backend runtime acceptance unless the existing specification says otherwise.

Start services using the repository's existing development scripts.

Do not introduce Docker Compose.

Do not introduce a production process manager for this local acceptance test.

Verify web health.

Verify API liveness and readiness independently if both endpoints exist.

Verify worker readiness by confirming:

process stays alive

Redis connection succeeds

database connection succeeds where required

queue initialization succeeds

no startup exception occurs

Do not treat “process is running” alone as readiness.

10. Health endpoints

Verify the existing health implementation.

Expected conceptual separation:

liveness:
process is alive

readiness:
required dependencies are usable

Readiness should verify relevant infrastructure such as:

PostgreSQL
Redis

Do not add excessive external dependency checks that would make the application unavailable unnecessarily.

Record the exact commands/URLs used to verify local health.

11. Full verification pass

After all fixes are complete, perform one clean final verification from the latest source.

At minimum run all repository-supported equivalents of:

pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build

Also verify individual applications/packages if the root command does not cover them:

web
API
worker
extension
desktop
shared packages
database package
rules engine if already present

No phase should be marked complete while a relevant check is failing.

Do not hide warnings that indicate actual correctness problems.

Separate harmless third-party build warnings from project defects.

12. Git snapshot

Only after the source passes the required checks:

git status
git diff
git diff --cached

Review the actual files going into the initial snapshot.

Confirm again that:

no .env

no credential

no private key

no local database

no build output

no node_modules

no sensitive runtime logs

are being committed.

Create the initial clean commit.

Use a descriptive commit message, for example:

chore: complete phase 1 project foundation

Do not force-push.

If a GitHub remote is already configured, push to the intended branch.

If authentication prevents the push, report the exact blocker rather than altering repository history.

After push, verify synchronization:

git status
git log -1 --oneline
git rev-parse HEAD
git rev-parse @{u}

Local HEAD and the intended upstream revision must match.

13. Do not introduce CI yet

Do not add:

GitHub Actions
GitLab CI
CircleCI
Docker-based CI

The current project decision is explicitly:

NO Docker
NO GitHub Actions

Verification remains local/manual at this phase.

14. Do not deploy

Phase 1 does not require production infrastructure.

Do not:

SSH into the production VPS

configure production Nginx

create production systemd services

create live DNS entries

create live databases

deploy the web application

provision production Redis

expose any service to the public internet

Production deployment belongs to a later phase.

15. Documentation update

Once Phase 1 is genuinely complete, update:

IMPLEMENTATION_HANDOFF.md
IMPLEMENTATION_PLAN.md
SECURITY_STATUS.md
DEPLOYMENT_STATUS.md
KNOWN_LIMITATIONS.md

Record:

development environment used
Node version
pnpm version
PostgreSQL version
Redis version
migration status
test results
lint result
typecheck result
build result
web runtime result
API health result
API readiness result
worker result
extension build result
desktop build result
Git commit hash
upstream synchronization status
remaining warnings
remaining limitations

Mark Phase 1 complete only if its documented exit criteria are actually satisfied.

Phase 1 final acceptance criteria

Phase 1 is COMPLETE only when all of the following are true:

[ ] reliable development environment established
[ ] dependency installation succeeds
[ ] frozen lockfile install succeeds
[ ] formatting passes
[ ] lint passes
[ ] typecheck passes
[ ] test suite passes
[ ] web build passes
[ ] API build passes
[ ] worker build passes
[ ] extension build passes
[ ] desktop build passes
[ ] PostgreSQL isolated and operational
[ ] supported Redis operational
[ ] migrations successfully applied
[ ] fresh-database migration verified
[ ] web starts successfully
[ ] API starts successfully
[ ] API liveness passes
[ ] API readiness passes
[ ] worker starts and connects successfully
[ ] repository reviewed for secrets
[ ] initial Git snapshot created
[ ] GitHub upstream synchronization verified
[ ] Phase 1 documentation updated

If any item remains incomplete, report Phase 1 as PARTIAL, not complete.

Final report format

Return a concise but complete report containing:

Phase 1 status

COMPLETE

or:

PARTIAL

Environment

OS:
Node:
pnpm:
PostgreSQL:
Redis:

Verification

Install:
Formatting:
Lint:
Typecheck:
Tests:
Web build:
API build:
Worker build:
Extension build:
Desktop build:
Migrations:
Fresh DB migration:
Web runtime:
API liveness:
API readiness:
Worker runtime:

Git

Branch:
Commit:
Remote:
Push:
Upstream synchronized:
Secret review:

Remaining blockers

List only genuine unresolved blockers.

Files changed

Summarize meaningful source/configuration/documentation changes.

Do not begin Phase 2.

Finish Phase 1 first.
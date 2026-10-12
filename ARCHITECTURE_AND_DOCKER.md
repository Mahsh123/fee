# Fee Collection SaaS: Architecture, Folders, and Local Run Guide

This guide describes the repository as it exists today, the role of its main folders, and how its local and Compose deployments fit together. The detailed domain rules remain in [`docs/architecture/README.md`](docs/architecture/README.md) and the original fee platform architecture specification.

## Architecture at a glance

The product is a TypeScript modular monolith organized as an npm workspace:

```text
Browser ──> Next.js web app ──> NestJS API ──> PostgreSQL
                                      │
                                      └──> Redis queue ──> background worker
```

- **PostgreSQL is the financial source of truth.** Fee configuration, demands, payments, allocations, adjustments, audit history, and derived balances are kept in the relational database. Redis is for queue and short-lived operational state; it must not become the only copy of financial data.
- **The API is one deployable application with domain modules.** Fee catalog, fee policy, demands, payments, allocations, refunds, audit, and related domains have separate modules and services. The boundaries allow later extraction without adding service-to-service complexity to the current foundation.
- **The worker handles asynchronous work.** It consumes queued jobs for notifications and other background processing; it is a separate process and has a narrower environment than the API.
- **The web app is a separate Next.js process.** It calls the versioned API and contains the browser-facing pages and components.
- **Tenant ownership is explicit.** Tenant context is part of API authorization and database relations. Composite tenant-aware constraints and database role separation add protection below the HTTP layer.
- **Financial records are event-oriented.** Issued demands and documents are snapshots; payments are allocated; corrections are recorded as adjustments and ledger entries. Balances are derived from those records instead of being an independent source of truth.

This is a production-oriented foundation, but a provisioned database alone does not mean every product flow has passed end-to-end QA. See [Current Neon database state](#current-neon-database-state).

## Repository folders

| Path | Responsibility |
| --- | --- |
| `apps/api` | NestJS HTTP API. `src/modules` contains domain modules such as students, fee catalog, fee policies, demands, payments, refunds, reports, audit, and platform administration. `src/common` and `src/config` hold cross-module plumbing and configuration. |
| `apps/web` | Next.js user interface. `src/app` contains route/page areas, `src/components` reusable UI, and `src/lib` browser-side helpers. |
| `apps/worker` | Background job process for queue-driven work such as notifications, receipts, reminders, and retries. |
| `packages/database` | Prisma client creation and database access utilities. Runtime code uses the configured PostgreSQL driver adapter. |
| `packages/fee-engine` | Reusable fee calculation and policy evaluation logic. |
| `packages/money`, `packages/dates` | Shared money arithmetic and date/period rules. |
| `packages/payment-contracts`, `packages/receipts`, `packages/notifications` | Shared payment provider contracts and reusable receipt/notification services. |
| `packages/types`, `packages/validation`, `packages/config`, `packages/logger`, `packages/ui` | Shared API/domain types, input validation, configuration, logging, and UI components. |
| `prisma/schema.prisma` | Canonical database model. |
| `prisma/migrations` | Append-only SQL migration history. Do not rewrite migrations already recorded by a database; add forward migrations instead. |
| `prisma/migration-stages.json` | Ordering/stage metadata for migrations that must be applied around index-building barriers. |
| `prisma/seed` | Explicit first-install platform administrator/bootstrap data. It is not a sample tenant/student/payment dataset. |
| `features` | Feature requirements, behavior notes, and acceptance context by area. |
| `docs/architecture` | Architecture description and recorded decisions, including Neon and migration behavior. |
| `docs/database`, `docs/security`, `docs/payment`, `docs/fee-engine`, `docs/runbooks` | Operational and domain documentation grouped by subject. |
| `scripts` | Database role provisioning, staged migrations, ACL synchronization, audit key setup, tenant-safety generators/checks, local Neon launcher, and deployment helpers. |
| `infrastructure/docker` | Dockerfiles for API/backend, web, and backup images. |
| `infrastructure/nginx` | Reverse proxy configuration used by the Compose deployment. |

## Database roles and isolation

The managed Neon database is configured with separate logins:

- `fee_runtime` is the application connection for normal runtime work. It has no database-level or `public` schema object-creation right.
- `fee_migrator` is restricted to schema/deployment work. It retains `public` schema creation for future DDL migrations. Temporary database `CREATE` and private-schema access used during bootstrap were revoked after setup.
- `fee_backup` is read-oriented and has no insert or object-creation right on the tenant table in the effective permission check.

The development launcher reads the app environment and the Neon runtime URL, then removes migration, backup, database-target, and seed credentials before starting the API or worker. The one-shot development-tenant seed receives the restricted runtime database URL and, when configured, the demo owner email and password. The password is hashed before it is stored and is never logged. Do not put the Neon owner URL in the API or worker environment. Keep local `.env.*.local` files out of source control and do not paste passwords into logs or documentation.

## Current Neon database state

The initial Neon import was performed from the repository's immutable migrations rather than a partial local database dump. The old 45-migration/zero-row figures below were an earlier snapshot and are superseded by the latest recorded review.

The latest repository review, dated 2026-10-06, records:

- 54 staged migrations applied, including the generic branding and branding-trigger security migrations.
- Tenant relation preflight passed for 99 relations and the concurrent-index stage completed 192 indexes.
- ACL synchronization completed for 102 public relations and 94 tenant identity guards; audit signing-key checks completed.
- Organization branding backfill verified 5 rows with 0 mismatches.

On 2026-10-06, staged migration `20261006000800_platform_tenant_provisioning_idempotency` was applied to Neon. The staged deployment reported 55 migrations, passed tenant-relation preflight and index verification, provisioned audit signing keys, and synchronized/verified runtime and backup ACLs for 103 public relations and 94 tenant identity guards. This does not verify production DNS/TLS, backup restore, or live UI-to-Neon flows.

These are repository-documented results, not a fresh Neon query performed during the current audit. They verify schema/deployment work only; they do not prove every application feature end to end. Production DNS/TLS, live deployment health, and backup restore remain unverified. See [the current feature audit](docs/architecture/multi-tenant-saas-requirements.md) for product and integration status.

## Run the application locally against Neon without Docker

The repository has a dedicated launcher that starts the API, web app, and worker on the host. It uses the `fee_runtime` Neon URL for the API and keeps the migration and backup credentials out of application processes.

Prerequisites:

1. Node.js 20.10 or later and the workspace dependencies installed (`npm install`).
2. Local `.env` and `.env.neon.local` configuration files present. `.env.neon.local` must contain the runtime `DATABASE_URL`; the launcher validates the Neon host, runtime role, verified TLS, and channel binding. `.env.docker.local` may supply the local worker HMAC secret when it is not in `.env`.
3. Redis reachable at `localhost:6379` (or a `REDIS_URL` set in `.env`). Redis is used for queues, not as the financial database.

From PowerShell in the repository root:

```powershell
npm run dev:neon
```

The launcher starts:

- Web app: `http://localhost:3000`
- API: `http://localhost:4100` in this local Neon setup (readiness endpoint: `/health/ready`). Port 4000 is already occupied by a Windows system process on this machine.
- Worker: background queue consumer; it has no browser page

Stop the processes with **Ctrl+C** in that terminal. At the time this guide was written, a local connection check to Redis port 6379 succeeded. The application processes themselves have not been started as part of the Neon schema import.

### Browser entry and sign-in routing

- `http://platform.localhost:3000/` is the platform landing page and Super Admin entry. The base domain `localhost` is not an admin login host.
- Workspace routes such as `/academic` require a signed-in session. An unauthenticated visitor is sent to `/login?next=...`; successful sign-in returns to the requested same-origin route unless the account must change its temporary password first.
- The browser shell waits for the API session refresh before showing tenant navigation. If refresh fails, it clears the cached browser session and shows the public/sign-in flow. Backend authentication, role checks, permissions, and tenant scoping remain authoritative for all data requests.
- The public landing page does not expose tenant or financial data. The API base URL for the local Neon run is `http://platform.localhost:4100/api/v1`.
- `http://platform.localhost:3000/` is the platform landing page; `http://demo.localhost:3000/`, `http://school.localhost:3000/`, `http://academy.localhost:3000/`, and `http://gym.localhost:3000/` resolve separate tenant landing pages. The browser sends API requests to the matching `*.localhost:4100` host so backend middleware resolves the same workspace. The `platform` tenant slug is reserved.
- The login form asks only for email and password. The hostname selects the institution; the API rejects an access or refresh token used on a sibling tenant host.
- `npm run dev:neon` idempotently seeds three development tenants and their branding before services start. If `SEED_DEMO_PASSWORD` is at least 12 characters, it also creates `admin@demo-academy.test` (or `SEED_DEMO_EMAIL`) as a `TENANT_OWNER` for `demo.localhost`. The fixture has no student, fee, or payment records. Existing tenant settings, owner accounts, passwords, role assignments, and configured permissions are preserved. Set `SEED_DEVELOPMENT_TENANTS=false` to skip the seed.
- Tenant names, logos, colors, and landing content come from tenant branding configuration. The tenant provider displays explicit not-found and inactive pages when a subdomain has no active tenant.

### Production subdomain setup

- Set `TENANT_BASE_DOMAIN` to the shared suffix, such as `example.com`; `${PLATFORM_SUBDOMAIN}.example.com` is the Super Admin host and `tenant.example.com` routes by tenant slug. `PLATFORM_SUBDOMAIN` defaults to `platform`. The apex is not a platform login host and may serve a separate marketing site.
- Point `*.example.com` DNS to the reverse proxy. The TLS certificate must cover the wildcard name, including platform and tenant subdomains.
- Nginx preserves `Host: $host`; the API resolves the workspace from this validated host. Configure `WEB_APP_URL`, `CORS_ORIGINS`, and `NEXT_PUBLIC_API_BASE_URL` with the selected platform-label origin and proxy path. Build the web image with `NEXT_PUBLIC_PLATFORM_SUBDOMAIN` set to the same label; Compose also passes it to the running web container.
- Run database migrations through the staged pipeline before deploying the new application version. Development seeding only runs in the local Neon launcher with `NODE_ENV=development`.

The schema is empty of tenants and users. The initial platform administrator is intentionally not created with a guessed/default identity. A platform administrator must be bootstrapped with an operator-chosen email and strong password before login can succeed. Avoid using the Neon owner credential for this.

## What the Docker Compose files do

Both Compose files connect to the managed Neon database; neither creates a PostgreSQL container or provisions database roles. Redis remains in Compose for queues.

- `docker-compose.yml` starts Redis, API, worker, web, a one-shot idempotent development tenant seed, and a plain-HTTP Nginx proxy by default. Open `http://${PLATFORM_SUBDOMAIN}.localhost:8080` for Super Admin access or `http://demo.localhost:8080` (and the other tenant subdomains) for a tenant. `PLATFORM_SUBDOMAIN` defaults to `platform` and is passed to the API and Next.js web server. Nginx preserves the host so the backend resolves the correct identity scope. The API receives only `DATABASE_URL`, which must be the pooled `fee_runtime` Neon URL. Migrations run separately with `npm run db:deploy:neon`; the API readiness check verifies Neon before seeding, and the proxy waits for seed completion.
- `docker-compose.prod.yml` provides Redis, a direct-URL staged migration job, a one-shot platform seed, API, worker, web, Nginx, and encrypted logical backups using the separate `fee_backup` role. Provision Neon roles and grants first. The Neon owner URL is supplied only to the one-shot platform bootstrap. Production API, worker, web, operations, and backup images use the same required commit-SHA `IMAGE_TAG`; CI publishes them to GHCR after verification, and `scripts/deploy-production.mjs` pulls those images before startup. Single-host resource defaults and off-site backup configuration are documented in the [production deployment and recovery runbook](docs/architecture/production-deployment-hardening.md).
- `infrastructure/docker/*.Dockerfile` builds service images. The API Dockerfile's `runtime` target is used by local Compose and one-shot operations; its default `production-runtime` target contains only production npm dependencies. The web image uses Next standalone output. `infrastructure/nginx/nginx.conf` configures the production reverse proxy.

For local containers, copy `.env.example` to `.env`, set `DATABASE_URL` to the pooled `fee_runtime` Neon URL, and replace the local JWT, encryption, and notification HMAC placeholders. Plain `docker compose up --build` reads the root `.env`; it does not automatically load `.env.neon.local` or `.env.docker.local`. Apply schema changes first with `npm run db:deploy:neon`. The API health check waits for Neon readiness, the seed then creates tenants for `demo.localhost`, `school.localhost`, `academy.localhost`, and `gym.localhost`, and Nginx starts after the seed completes. Set `SEED_DEMO_PASSWORD` to a local temporary password if you also want sample tenant administrator accounts. Use `http://platform.localhost:8080` for platform administration and a tenant subdomain such as `http://demo.localhost:8080` for tenant administration. `npm run docker:up` validates the root `.env` against the Neon target before building and starting the same stack in the background. Run `npm run docker:watch` to use Compose Watch for frontend Fast Refresh across the web app and shared UI packages. The API and worker run compiled code, so rebuild their image after backend source changes. The seeder preserves existing tenant settings and accounts; Compose does not delete existing volumes. Stop with `npm run docker:down`. For host-based development, `npm run dev:neon` reads `.env.neon.local` and starts API, web, and worker without Docker. Compose deployment decisions and recovery notes are recorded in [ADR 20261005](docs/architecture/decisions/20261005-neon-compose-runtime.md).

Production images are built and published by `.github/workflows/ci.yml` for verified commits pushed to `main`. Use the full `sha-<commit>` tags; the production environment example does not use `latest`. See the [production release and rollback procedure](docs/architecture/production-deployment-hardening.md).

For a custom platform label, set `PLATFORM_SUBDOMAIN` in the deployment environment, use that label in `WEB_APP_URL`, `CORS_ORIGINS`, and `NEXT_PUBLIC_API_BASE_URL`, and build the web image with the matching `NEXT_PUBLIC_PLATFORM_SUBDOMAIN` value. The public value is compiled into the browser bundle, so the image build argument and Compose runtime setting must match. The CI web image build reads the label from the repository variable `PLATFORM_SUBDOMAIN` and falls back to `platform`.

Useful scripts are declared in the root `package.json`:

```text
npm run dev:neon       Start local API, web, and worker with Neon runtime configuration
npm run docker:up      Build and start the Neon-backed local Compose app stack
npm run docker:watch   Start Compose with frontend source sync and Next Fast Refresh
npm run docker:down    Stop the local Compose stack without deleting volumes
npm run test:compose-target  Render and verify development and production Neon Compose configs
npm run db:generate    Regenerate Prisma client and tenant relation artifacts
npm run db:deploy:neon Apply staged migrations with Neon direct migration credentials
npm run test           Run the configured test suite
npm run build          Build workspace applications and packages
npm run typecheck      Type-check workspace applications and packages
```

Do not run `db:reset` or `db:push` against Neon. Schema changes should be reviewed and added as forward migrations, then deployed through the staged migration process.

## Further reading

- [Domain architecture](docs/architecture/README.md)
- [Database operations](docs/database/README.md)
- [Neon managed PostgreSQL decision](docs/architecture/decisions/20261005-neon-managed-postgres.md)
- [API and worker notification boundary](docs/architecture/decisions/20261003-notification-worker-database-boundary.md)

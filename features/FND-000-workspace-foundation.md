# FND-000 — Workspace foundation and verification gates

> The verification notes in this feature record the original workspace foundation.
> The active Compose database setup was updated on 2026-10-05 to Neon; run
> `npm run test:compose-target` for current Compose configuration checks.

## Purpose

Make the declared modular-monolith workspaces buildable and give local and CI runs one truthful, repeatable baseline before business modules are added.

## Architecture and boundaries

- Keep the existing npm-workspaces and Turbo monorepo.
- Keep reusable domain logic in `packages/*`, transport/application orchestration in `apps/api`, the browser client in `apps/web`, and background execution in `apps/worker`.
- This feature supplies package entry points and app bootstraps only where absent. It does not add fee, student, payment, or tenant workflows.
- A package must export a real capability or be explicitly removed from the workspace and dependency graph; placeholder source and pass-with-no-tests are not completion.
- Validation commands must target authored TypeScript and intentional test files, never generated JavaScript under `dist` or generated Prisma sources.

## Current findings

- Turbo initially could not identify a package manager; the root now declares npm 11.11.1.
- `apps/api` has a working NestJS source tree and package-level build/test/typecheck scripts.
- `apps/web`, `apps/worker`, and the declared `config`, `logger`, `notifications`, `receipts`, `ui`, and `validation` workspaces had no usable authored entry points.
- The root lint task has no workspace implementation or configured linter; the existing option is to remove it until a linter is intentionally adopted.
- Vitest already selects authored `.spec.ts` / `.test.ts` files and excludes `dist`; the false-green risk is `--passWithNoTests` on empty workspaces, not generated test discovery.
- Root-wide build, typecheck, and test gates fail on empty `config`, `logger`, and `ui` workspaces. The worker production tsconfig also lacks test exclusions.
- Workspace and root `clean` commands use POSIX `rm -rf`, which is not portable to Windows.
- CI hardcodes a subset of workspace builds, uses `--if-present` for typecheck/tests, and omits the web production build.

## Changes in scope

- Retain focused Vitest discovery for authored spec and test files, and enforce the no-tests policy.
- Add meaningful production entry points for retained workspaces that match their declared package boundaries, with tests for runtime behavior and no customer-specific fee behavior. Remove a package from the workspace/dependency graph if its capability belongs to a later feature phase; do not add empty barrels or placeholder tests. Keep the API, web, and worker applications.
- Make API and worker production TypeScript builds exclude tests and generated output.
- Replace shell-specific clean commands with a path-restricted Node cleanup script that works on Windows, macOS, and Linux.
- Remove the root lint command until a linter is intentionally adopted and configured; never alias lint to typecheck.
- Bring CI commands into alignment with root local verification scripts, build the web app and all three architecture images, and keep image verification build-only.
- Record the remaining service-level and data integrity work as open, rather than claiming the whole product is complete.

## Database impact

None. Prisma schema and migrations are unchanged by the workspace bootstrap itself.

## API impact

No business API routes are added. The API keeps its NestJS entry point and health/auth routes. Readiness now stays available when Redis is degraded, while required dependency failures remain `not_ready`; the production probe reads the API's standard `{ success, data, requestId }` response envelope.

## Security, tenant, and financial impact

- No financial state is changed.
- Empty web/worker directories do not count as tenant-safe applications; this feature only restores their compile/run boundary.
- The notification worker receives Redis, SMTP, a delivery-result callback URL, and a dedicated HMAC callback secret. It receives no database URL, JWT secret, audit signer, or payment gateway credentials. The API performs database-backed notification work under tenant context and authenticates worker callbacks with timestamp, nonce, and body-bound HMAC verification.
- Logger defaults redact the credential-bearing environment fields, including nested config-shaped objects.
- Job tenant rehydration, tenant-aware relations, and deployment trust boundaries remain separate acceptance gates before background financial work is implemented.

## Acceptance criteria

- [x] Every retained workspace has meaningful authored source that matches its boundary; deferred package boundaries are removed from the active workspace and dependency graph until implemented. API, web, and worker remain declared applications.
- [x] Root build, typecheck, and tests execute truthful commands without no-test false greens or generated-file false positives. Root lint is absent until a real linter is configured.
- [x] Cross-platform clean removes only known workspace build outputs; it ran on Windows and rejected an unapproved path.
- [x] API, worker, and web production builds succeed from a clean generated-output state; API and worker outputs exclude test files.
- [x] Every runtime-bearing package and app has discovered tests; Vitest fails when a workspace has no tests.
- [x] CI image-build workflow is configured for API, worker, and web with push/deploy disabled; all three local image builds succeed.
- [x] Tenant/auth API integration and Prisma validation remain intact; readiness semantics and response-envelope probing are covered by unit and HTTP integration tests.
- [x] Architecture, security/tenant, and QA reviewers independently accept the foundation.
- [x] Relevant tests, documentation, and verification record are current.

## Implementation record

- Shared, process-agnostic runtime configuration and reusable auth validation now live in `@fee/config` and `@fee/validation`; the API keeps its Nest adapter and routes.
- `@fee/logger` emits structured Pino records with secret redaction; `@fee/notifications` renders plain-text templates with own-property path lookup; `@fee/receipts` renders caller-supplied document snapshots to escaped HTML and PDF; `@fee/ui` exports tested accessible button/class helpers.
- The worker has a delivery-only config profile. Notification outbox polling, reminders, rendering, and persisted state transitions run in the API under rehydrated tenant context; queue payloads include `tenantId`. The worker sends rendered email and reports results through a replay-protected, tenant-scoped API callback. Development and production Compose files omit database credentials from the worker.
- The API readiness status tolerates optional degraded dependencies while failing required dependency outages. The production Compose healthcheck safely parses the standard response envelope and only accepts `{ data: { status: 'ready' } }`.
- The web app now has a neutral accessible App Router shell.
- Cleanup uses an allowlisted Node script. Root CI gates now call the same root build, typecheck, and test commands; the container job builds all three images without pushing or deploying.
- The backend Dockerfile supplies a non-secret database URL only in its intermediate build stage for Prisma generation and builds API/worker production output before copying it into runtime images.
- The notification worker boundary is recorded in [the 20261003 decision](../docs/architecture/decisions/20261003-notification-worker-database-boundary.md). The API now owns notification orchestration and the worker receives rendered, tenant-qualified delivery jobs only. These assembly changes have not passed consolidated verification.

### Local verification

- `npm run clean`: passed; the cleaner rejected an unapproved `..` target.
- `npm run build`: 15 of 15 workspace builds passed, including API, worker, web, and the standalone Next output.
- `npm run typecheck`: 27 of 27 Turbo tasks passed.
- `npm test`: 27 of 27 Turbo tasks passed, 166 tests across all workspaces.
- `npx prisma validate`: passed. API integration tests passed, and no spec/test files were emitted in API or worker `dist`.
- The standalone web server smoke test returned HTTP 200 and rendered the workspace heading. The API health HTTP integration test confirmed the readiness payload is wrapped under `data` and that Redis degradation remains ready while a database outage is not ready.
- `docker compose --profile full -f docker-compose.yml config` and `docker compose -f docker-compose.prod.yml config` passed; both Compose worker environments contain only `NODE_ENV` and `LOG_LEVEL`.
- Local build-only image builds passed for `fee-platform/api:fnd-000`, `fee-platform/worker:fnd-000`, and `fee-platform/web:fnd-000`. No image was pushed and no deployment was run.

## Verification record

The verification results below are the earlier foundation baseline. The notification dispatcher, callback security, and delivery-only worker changes recorded above were added afterward and are intentionally awaiting the consolidated backend/frontend verification gate.

- Architecture review plan: ACCEPTED before implementation; final implementation review PASS.
- Security/tenant review: PASS; worker secrets are isolated and configured credential fields are redacted.
- QA: PASS; build/typecheck/test gates, readiness edge cases, response envelope, and both Compose configurations verified.
- Financial/domain review: NOT APPLICABLE; no financial behavior is implemented.
- Root verification: PASS; clean 15/15, build 15/15, typecheck 27/27, tests 27/27 (166 passing), Prisma validation, both Compose config checks, and three build-only images.

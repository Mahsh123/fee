# Notification worker database boundary

## Status

Implementation decision for this batch; pending consolidated architecture and security review. It preserves the modular-monolith and worker credential boundaries in FND-002.

## Context

Architecture §7 requires tenant context for every tenant-owned query and job. FND-002 and DB-002 require the worker to receive no database credentials. The current notification worker contradicts both boundaries: it creates its own Prisma client from `DATABASE_URL`, scans the tenant directory, polls tenant-owned outbox and fee records, materializes notifications, and updates delivery state. Queue delivery jobs do contain `tenantId`, but database work does not rehydrate the API's tenant context.

## Decision for this implementation batch

Move database-backed notification orchestration into the API's notification module. The API remains the trusted transactional outbox consumer and reminder scheduler. Before every tenant-owned read or write, it enters an explicit tenant context and uses the tenant-scoped Prisma facade. The global tenant-directory scan is an explicit platform operation that yields IDs only; all subsequent outbox, reminder, student, guardian, template, and notification operations run in the matching tenant context.

The API produces BullMQ email-delivery jobs containing `tenantId` and only the rendered delivery data needed by the worker. The worker becomes delivery-only: it consumes those jobs, sends email, and submits a result to a narrow API callback authenticated with a versioned HMAC over the request body, timestamp, and nonce. The API callback validates the tenant-bound payload, rehydrates tenant context, and applies an idempotent notification state transition. The worker receives Redis and SMTP credentials, but no database URL, migration credentials, audit signer, or financial secrets.

## Impact and migration

- No Prisma schema or financial-record migration is required. Existing outbox rows, notification rows, and Redis job IDs retain their meaning.
- Deploy the API producer and signed result callback first; verify it accepts and emits tenant-qualified delivery jobs. Then deploy the delivery-only worker and drain old worker instances before removing `DATABASE_URL` from the worker environment and configuration schema.
- Keep queue names and job IDs stable during the transition. Duplicate jobs remain safe through the existing notification dedupe key and tenant-scoped state updates.
- API replicas may each poll, so outbox status claims, notification uniqueness, dedupe keys, and transactional row updates remain the concurrency controls. Reminder scheduling remains per tenant and restart-safe.
- HMAC callback credentials are separate from JWT, database, and audit-signing secrets. Callback timestamps and nonces are bounded and replay-protected; responses expose no database details.

## Review gate

Consolidated review must verify there is no database credential in the worker's rendered Compose configuration or process environment; every API-side tenant operation has a tenant context; callbacks cannot update a notification in another tenant; message delivery retries and callback replay do not duplicate terminal transitions; multiple API replicas do not lose or double-publish outbox events; and SMTP/Redis failure behavior remains observable and recoverable.

# OPS-001 — Notification templates and outbox delivery

## Scope

Tenant settings administrators can save locale-specific event templates and review delivery history. The API scans the transactional outbox inside each tenant context, creates deduplicated tenant notification rows, and queues rendered email jobs for the delivery-only worker.

## Reliability and tenant rules

- Outbox claims are compare-and-set updates scoped by `(tenantId, id)`; failed work retries with bounded exponential backoff.
- Notification dedupe keys derive from the source outbox event and recipient address hash.
- The API discovers active tenant IDs from the platform directory, then rehydrates tenant context before reading or writing that tenant's outbox, reminders, students, guardians, templates, and notification rows. The worker does not connect to PostgreSQL.
- Emails are sent only to the student's saved address and selected primary guardian contacts; browser checkout results are never used as notification evidence.
- Notification rows keep attempt counts, safe error codes, timestamps, and provider message IDs. Templates are not rendered with data outside the event's tenant. Delivery callbacks update only the matching `(tenantId, notificationId)` row, and per-attempt updates are idempotent.

## Runtime and interface

- The API exposes tenant-scoped template and history endpoints under `/notifications`.
- The API exposes a narrow signed delivery-result callback; the worker uses only Redis, the callback URL, a dedicated HMAC secret, and SMTP delivery settings. It receives no database, JWT, audit-signer, or gateway credentials.
- Email events are rendered with the shared safe template renderer and delivered through BullMQ-backed retries.
- The API uses each tenant's timezone and `reminderScheduleDays` to create `FEE_DUE` outbox events, emits one idempotent `FEE_OVERDUE` event per overdue demand, and creates `INSTALLMENT_DUE` events for open installments whose due date has passed. Event creation is paged and uses tenant-scoped dedupe keys so API restarts and multiple replicas do not duplicate reminders. Stale PROCESSING outbox claims expire and can be reclaimed.

SMS, WhatsApp, and push adapter credentials/delivery remain unimplemented and must be added through reviewed provider adapters before those channels are enabled for production use.

The API dispatcher, tenant context rehydration, delivery-only worker, HMAC callback, and runtime ACL entries are assembled. Functional, tenant-isolation, callback replay, multi-replica idempotency, timezone-boundary, and PostgreSQL ACL checks remain in the consolidated final verification pass.

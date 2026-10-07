# ADR — Deduplicate only verified provider events

**Status:** Accepted
**Date:** 2026-10-05

## Context

The public webhook endpoint previously inserted a `GatewayWebhook` row using a provider-controlled event ID before rejecting an invalid signature. The unique `(tenantId, provider, externalEventId)` index then allowed an unauthenticated request to reserve that ID. A later legitimate signed event with the same ID could be acknowledged as a duplicate without posting its payment.

## Decision

- Verify the raw provider request signature before creating a provider-event row.
- Keep invalid attempts out of the provider-event deduplication namespace and reject them without financial or webhook-row writes.
- Derive event identity only from signature-covered data: use IDs inside signed bodies, use the verified signature fingerprint for PayU because its `mihpayid` field is not covered, and fall back to the raw-body hash when a signed body has no event ID. Ignore unsigned event-ID headers for deduplication. Do not promote PayU's unsigned `mihpayid` or currency into trusted payment identifiers.
- On duplicate keys, compare the canonical persisted JSON payload with the incoming payload before returning a duplicate or retrying processing. A same-key/different-payload event fails closed.
- Cashfree's timestamp remains part of signature verification, but there is no local freshness cutoff. Cashfree documents at-least-once delivery, retries and dashboard resends; signed body identity, payload matching, and transactional payment state make a replay idempotent without rejecting delayed legitimate deliveries. See [Cashfree webhook retry and signature guidance](https://www.cashfree.com/docs/payments/online/webhooks/overview) and [Cashfree idempotency guidance](https://www.cashfree.com/docs/payments/online/webhooks/webhook-indempotency).
- Enforce uniqueness only for rows where `signatureValid = true`, scoped by tenant, provider, and gateway environment. A provider event in TEST must not suppress a matching event ID in LIVE.
- When resolving a uniqueness conflict, query only a verified row so any legacy invalid-signature row cannot mask a valid event.
- Keep the existing tenant and gateway configuration scope, event processing transaction, payment capture, allocation, ledger, receipt, and reconciliation behavior.

## Impact

Invalid callbacks remain visible through structured rejection logs but are not stored as retryable provider events. Verified provider events remain persistently deduplicated and auditable. Existing invalid-signature rows no longer reserve event IDs after the migration.

## Migration

The staged migration runner builds the Prisma-schema-derived partial unique index concurrently through its journaled index runner before this canonical migration. It verifies the index definition and predicate while the old full unique index remains active. The canonical migration then drops the old index and renames the replacement in a short transaction with a bounded lock timeout. A failed concurrent build cannot remove existing deduplication; a later runner attempt adopts an exact valid index or removes and rebuilds only an invalid temporary index. Existing valid rows are already unique under the old index, so no data rewrite is needed. The change is append-only in migration history; rollback is forward-only if invalid rows accumulate after the partial index is installed.

If Prisma records this migration as failed, first inspect the migration record and both index definitions. Only after confirming the old index remains valid should the migration role run `prisma migrate resolve --rolled-back 20261005000200_verified_webhook_event_deduplication`; then rerun the staged deployment. Do not mark the migration applied or manually drop the old deduplication index. The recovery details and transaction-boundary decision are recorded in [the staged webhook index ADR](./20261005-staged-webhook-partial-index.md).

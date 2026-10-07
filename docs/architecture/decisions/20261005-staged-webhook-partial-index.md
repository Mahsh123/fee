# Stage Verified Webhook Index Builds Outside Prisma Migrations

## Status

Accepted on 2026-10-05 after the Neon development deployment exposed a transaction-boundary mismatch.

## Issue

The verified webhook deduplication migration contains `CREATE INDEX CONCURRENTLY` and `DROP INDEX CONCURRENTLY`. The staged deployment runner applies canonical post-index migrations with `prisma migrate deploy`; Prisma executes this migration in a transaction context on the configured Neon target. PostgreSQL rejects concurrent index DDL inside a transaction, so the migration failed before its index swap could run. The preceding tenant-branding migration had already applied.

## Proposed change

Keep non-transactional index construction in the repository's standalone concurrent-index runner. Add a post-index barrier before the verified-webhook deduplication migration. Derive the partial index definition and canonical source name from the Prisma schema, map its temporary build name through the barrier manifest, extend the generic index-plan parser/validator to represent boolean equality predicates, and use the existing restartable journaled concurrent builder. Remove concurrent DDL from the Prisma migration; leave only the bounded transactional index swap there.

## Impact

- No payment, allocation, ledger, or webhook row data is rewritten.
- The existing full unique index remains active while the replacement partial unique index is built.
- The replacement index is journaled and verified against its schema-derived definition before the old index is removed.
- The deployment runner gains a reusable post-index barrier, explicit schema-name aliases for temporary indexes, and support for boolean partial-index predicates.
- The canonical migration remains append-only and transaction-safe. Existing databases can recover a failed attempt, build/adopt the replacement index, and apply the corrected migration without manually dropping the existing deduplication index.

## Migration and recovery approach

1. Inspect Neon migration history and index catalog state without changing them. Confirm the old unique index remains valid; record whether a valid or invalid temporary index exists.
2. Update the post-index barrier and concurrent-index runner, and reduce the Prisma migration to a short transaction that sets a bounded lock timeout, drops the old index, and renames the already-built replacement.
3. If Prisma recorded the prior attempt as failed, use the migration role to mark only `20261005000200_verified_webhook_event_deduplication` rolled back after catalog verification. Do not mark it applied and do not drop the old index manually.
4. Rerun the staged deployment. The standalone runner adopts an exact valid temporary index or removes/rebuilds only an invalid temporary index; the migration then swaps indexes transactionally.
5. Verify the replacement index definition/predicate and Prisma migration history, then continue audit-key and ACL synchronization and seed the development tenants.

# ADR: Interleaved pre-index and post-index migration stages

## Status

Accepted for implementation. The staged migration runner and migration manifest will be updated together; no database migration has been run as part of this change.

## Issue

The staged deployer currently requires all pre-index migrations to form a timestamp prefix followed by all post-index migrations. That prevents a later additive feature from creating a table before the concurrent-index phase once any post-index migration already exists. The checked-in stage manifest also does not classify the feature migrations added after the initial tenant-constraint rollout, so the current deployer rejects the repository history as incomplete.

The payer responsibility feature adds tenant-owned tables and composite tenant foreign keys. Creating those tables after the concurrent-index phase would leave the index plan unable to build their unique target keys and child indexes concurrently. Creating the composite foreign keys in the pre-index phase would skip the established add-after-index / validate-after-add sequence.

## Decision

Allow the stage manifest to classify any migration as pre-index or post-index, while requiring that the union is complete, unique, and that each stage remains internally timestamp ordered. Keep deployment phases unchanged:

1. Apply every pending pre-index migration using the filtered, checksum-verified history.
2. Run tenant-reference preflight and the restartable concurrent-index builder against the final Prisma schema.
3. Apply the full canonical migration history; already-applied migrations are skipped, and pending post-index migrations run in canonical timestamp order.
4. Synchronize and verify database ACLs.

New tenant-owned tables and columns go in pre-index migrations without tenant-to-tenant composite foreign keys or secondary indexes. The schema-driven index stage builds primary composite keys and child relation indexes concurrently. New composite foreign keys go into later post-index migrations, first `NOT VALID`, then validated in a separate migration.

## Impact

- Fresh databases can create additive feature tables before the index stage, then add constraints after required indexes exist.
- Existing databases can apply a later pre-index migration even when older post-index migrations were previously applied. The filtered pre-index history applies only missing pre-index migrations; canonical deployment then skips recorded migrations and applies remaining post-index work in timestamp order.
- The manifest no longer implies a single timestamp boundary, so validation must independently verify ordering within both stage lists and exact coverage of the canonical migration directories.
- No financial records or existing migration files are rewritten. The migration ledger remains Prisma's source of truth.

## Migration approach

- Update the stage validator and tests to accept a complete interleaved classification.
- Classify existing feature schema migrations as pre-index and retain the existing tenant-constraint migrations as post-index.
- Create payer responsibility tables, allocation columns, permission rows, and the student-balance backfill in a pre-index migration without secondary indexes or tenant-to-tenant composite foreign keys.
- Add payer-related composite foreign keys as post-index `NOT VALID` constraints and validate them in a subsequent post-index migration.
- During consolidated verification, rehearse clean-database and already-upgraded-database paths on PostgreSQL, compare financial snapshots, and inspect concurrent index and constraint catalog state.

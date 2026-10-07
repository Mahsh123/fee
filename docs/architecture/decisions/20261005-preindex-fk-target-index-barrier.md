# Pre-index barriers for migration foreign-key target indexes

## Status

Accepted for the staged migration runner.

## Issue

`20261001000200_refund_allocation_reversals` is classified as pre-index because it
creates a table and columns needed by the concurrent-index stage, but it also creates
tenant-composite foreign keys to `payment_methods`, `refunds`, `payments`, payment and
credit allocations, credits, and demand tables. Their matching unique keys exist in the
Prisma schema but are normally built after all pre-index migrations. On a clean
PostgreSQL 17 deployment the foreign keys therefore fail before index planning runs.

The first local attempt added four columns and stopped at the payment-method foreign
key. After that prerequisite key was built, a retry exposed the other missing target
keys and partially created the refund-allocation table. The local credits, refunds,
and refund-allocation tables contain no rows; the incomplete objects were removed
before the next retry.

## Decision

Keep the canonical migration file and checksum unchanged. Extend the migration-stage
manifest with declarative **pre-index index barriers**. Before a pre-index migration
named by a barrier, the staged runner applies all preceding pre-index migrations,
generates the requested index from the current Prisma schema, and builds it through
the existing restartable concurrent-index runner and journal. It then continues with
the blocked pre-index migration. The normal full index pass remains in place and
re-verifies the complete plan.

The barrier names schema index requirements, not customer-specific fee behavior. It
fails closed if an index name is absent from the schema-driven plan.

## Impact and migration approach

- Every schema-derived target key required by the refund migration is created
  concurrently before its foreign keys. Existing valid indexes are adopted by the
  runner.
- No payment, refund, credit, demand, or ledger record is rewritten.
- Before retrying a failed migration, inspect every partial object and row count. For
  this empty local database, the exact partial table, foreign key, index, and four
  columns were removed in one transaction; Prisma's supported
  `migrate resolve --rolled-back` operation then allowed the staged deployment to
  retry. Populated deployments require a reviewed repair that preserves financial
  data.
- Do not change the historical migration bytes, mark it applied, or reset a populated
  database to recover this ordering defect.

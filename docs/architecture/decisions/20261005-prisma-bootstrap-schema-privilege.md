# Temporary database CREATE privilege for Prisma bootstrap

## Status

Accepted for the Compose migration path.

## Issue

The checksum-verified initial Prisma migration starts with
`CREATE SCHEMA IF NOT EXISTS "public"`. PostgreSQL requires the migration role to
have `CREATE` on the database to execute that statement, even when `public` already
exists. The DB-002 steady-state ACL intentionally grants the migration role only
`CONNECT` at database scope and `USAGE, CREATE` on `public`, so a clean Compose
database could not apply the canonical migration. The local failure occurred before
any application enum or table was created; only Prisma's migration-tracking table
exists.

## Decision

Preserve the canonical migration bytes and checksums. During the one-shot database
bootstrap, grant database-level `CREATE` to the migration role and ensure runtime,
backup, and `PUBLIC` do not receive it. Run the existing staged migration process
with its migration-only credential. After it succeeds, a separate one-shot finalizer
revokes database-level `CREATE` and verifies that the migration, runtime, and backup
roles no longer have it. API startup is gated on successful finalization.

The migration container does not receive the bootstrap administrator credential.
This is a temporary deployment privilege, not a steady-state application capability.

## Impact and failure handling

The bootstrap role temporarily grants one additional capability to the trusted
migration login. The migration role already has reviewed DDL authority in `public`;
database-level `CREATE` additionally permits schema creation until finalization. If
migration or finalization fails, API and worker startup remain blocked. A failed
migration may leave the temporary grant in place so a deployment operator can inspect
and recover the failed migration. After confirming a failed migration applied no
partial DDL, mark it rolled back with Prisma's supported `migrate resolve --rolled-back`
operation, rerun the full Compose deployment, and confirm finalization succeeds.
Never mark the migration applied or reset a populated database to recover this error.

## Migration and rollout approach

1. Keep the initial migration unchanged, preserving its checksum for existing
   installations.
2. Add the temporary grant to the transactional bootstrap and add an idempotent,
   administrator-only finalizer.
3. Order startup as PostgreSQL health, role bootstrap, staged migrations, privilege
   finalization, then API and worker startup.
4. On an existing deployment, the normal bootstrap/migrate/finalize sequence briefly
   opens the same privilege window and closes it before application processes start.
5. Verify the final database ACL through PostgreSQL role integration checks and the
   Compose target validator.

# DB-001 trigger feasibility fixture

This isolated fixture proves the PostgreSQL mechanics required before DB-001 enables any production relation edge. It is not the production lifecycle policy or production audit implementation.

## What it verifies

- Prisma 7.10 validates and generates the composite `NoAction` relation tuples and creates the generated client.
- `prisma migrate deploy` applies the fixture migrations to a clean PostgreSQL 17 database.
- Generated-client nested connects and relation reads work for the composite relations.
- All five optional-ID delete triggers run under the DML-only `db001_runtime` role. They lock and snapshot the complete child set before taking the audit head, preserve each source row and `tenantId`, clear only the optional ID, and append one before image for the target and each detached child.
- A fixture `delete_eligible` flag stands in for lifecycle approval. Ineligible deletion fails without changing rows or appending events.
- The three payment/provider links have `NoAction`, no detach trigger, and reject target deletion while a source row remains.
- Tenant-owned row `tenantId` values and the parent `Tenant.id` cannot be changed under the runtime role, while same-value updates succeed. The rejected `Tenant.id` cascade attempt is checked against complete snapshots of all tenant-owned rows, references, audit head, and audit log.
- Runtime cannot read or INSERT/UPDATE/DELETE/TRUNCATE either audit table, call the internal append core, run DDL, or disable triggers. Trigger-generated direct-SQL events use a database actor.
- Audit sequence, links, hashes, nonces, and head state recompute correctly. A barrier-controlled competing delete completes with child-before-audit locking.
- Prisma migration diff reports no schema drift after deployment.
- The intentionally unsafe SetNull schema validates with a warning, generates whole-tuple `ON DELETE SET NULL`, and fails a PostgreSQL delete with SQLSTATE `23502` because `tenantId` is required.

## Run it

Use a disposable PostgreSQL 17 database. Generate the fixture migration SQL from the Prisma schema when that schema changes; `base.sql` is the generated initial migration copied into the fixture migration directory.

```powershell
$env:DATABASE_URL = 'postgresql://<migration-user>:<password>@127.0.0.1:55432/fee_db001'
npx prisma generate --schema prisma/prototypes/db-001-setnull/schema.prisma
npx prisma migrate deploy --config prisma/prototypes/db-001-setnull/prisma.config.ts

$env:DATABASE_URL = 'postgresql://db001_runtime:<password>@127.0.0.1:55432/fee_db001'
$env:ADMIN_DATABASE_URL = 'postgresql://<admin-user>:<password>@127.0.0.1:55432/fee_db001'
npx tsx prisma/prototypes/db-001-setnull/verify.mts

$env:DATABASE_URL = 'postgresql://<admin-user>:<password>@127.0.0.1:55432/fee_db001'
npx prisma migrate diff --from-schema prisma/prototypes/db-001-setnull/schema.prisma --to-config-datasource --script --exit-code
```

The prototype is intentionally limited to trigger, role, and composite-FK feasibility. Its fixture boolean is not a substitute for the production generated lifecycle/reference manifest. Its database-actor audit events are not a substitute for the signed v2 API envelope, canonicalization contract, or production audit cutover. Those remain required implementation and release gates.

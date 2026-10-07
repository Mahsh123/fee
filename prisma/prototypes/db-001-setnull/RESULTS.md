# DB-001 trigger feasibility results

Run against an empty PostgreSQL 17 Alpine database on 2026-09-29 using Prisma CLI/client 7.10.0.

- Prisma validation and client generation: passed.
- `prisma migrate deploy` from empty: passed; both fixture migrations applied.
- Prisma migration status: schema up to date.
- Prisma schema-to-database diff: empty, no drift.
- Generated-client composite nested connect/read: passed.
- Five optional-ID detach triggers under `db001_runtime`: passed; full PostgreSQL `to_jsonb` snapshots taken before deletion exactly match each target and detached-child audit before-image, source rows survived, only the optional ID changed, and tenant IDs were unchanged.
- Ineligible deletion: rejected with no row or audit changes.
- Three `NoAction` provenance edges: each target delete was rejected with no detach audit event.
- Tenant immutability: direct SQL tenant reparenting was rejected on root and dependent rows; same-value updates succeeded. Updating `Tenant.id` while dependent business rows, references, audit head, and audit events existed was rejected with SQLSTATE `42501`; complete before/after snapshots matched, and a same-value `Tenant.id` update succeeded.
- Cross-tenant composite FK insert: rejected.
- Runtime ACL checks: SELECT, INSERT, UPDATE, DELETE, and TRUNCATE against both `audit_log` and `audit_chain_heads`, direct append-core calls, DDL, and trigger disabling were rejected. Every persisted prototype trigger event was attributed to `DATABASE`; runtime role is not superuser, role/database creator, or a member of the owner role.
- Audit chain: contiguous sequence, recomputed hashes, previous links, unique nonces, and per-tenant head agreement passed.
- Lock-order race: passed. While one runtime session held a child row, a competing target delete completed its detach and audit append; the waiting delete then completed after the child lock was released.
- Unsafe Prisma-generated composite SetNull: reproduced. Prisma validates with a warning, emits `ON DELETE SET NULL` across `(tenantId, parentId)`, and PostgreSQL rejects the target delete with SQLSTATE `23502`; the source row remains unchanged.

Scope: these results prove SQL mechanics only. The fixture `delete_eligible` flag does not prove the production lifecycle/reference manifest. Database-actor events do not prove the signed v2 API envelope, key rotation, or audit cutover. Those requirements remain gated for the production implementation and separate review.

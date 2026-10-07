# ADR — Support the Neon managed PostgreSQL project

**Status:** Accepted for the user-requested Neon connection  
**Date:** 2026-10-05

## Context

The local Compose database bootstrap was built for a bundled PostgreSQL server. It requires a true PostgreSQL superuser, changes connection ACLs across every database in the cluster, and expects one host for application and migration connections. Neon exposes a managed PostgreSQL database where the project owner is not a PostgreSQL superuser. Neon also supplies a pooled endpoint for application traffic and a direct endpoint for schema deployment.

The user selected the Neon database `neondb` for local application use. A read-only preflight confirmed PostgreSQL 18.6, an empty `public` schema, and a project owner role with `CREATEROLE`, database `CREATE`, and database ownership, but without `SUPERUSER`. Prisma currently lists PostgreSQL 18 and Neon among its supported targets.

During the first bootstrap attempt, Neon accepted `CREATE ROLE` but rejected a following `ALTER ROLE` with SQLSTATE `42501` (`permission denied to alter role`). The bootstrap transaction rolled back, and a subsequent read-only check confirmed that no roles or tables were left behind.

Neon then rejected a SCRAM verifier supplied in `CREATE ROLE` with a control-plane HTTP 400 stating that it only accepts plaintext passwords. That commit also failed atomically; a read-only state check confirmed that no roles, schemas, extensions, or tables were persisted.

A second read-only catalog check found that Neon also exposes provider-owned `neon_service` and `neon_superuser` roles with effective `CONNECT`, `TEMP`, and database-level `CREATE` on the target. `neon_service` is a login member of `neon_superuser`; neither provider role has `CREATE` on `public`. These are provider principals, not application roles, and their privileges cannot be treated as customer-controlled ACLs.

Neon owns pgcrypto's extension-member functions as `cloud_admin` and leaves `PUBLIC EXECUTE` on them. They reside in `app_private`, where `PUBLIC` has no schema `USAGE`; only the runtime login and function-owner roles have `USAGE`. The ACL synchronizer therefore excludes only functions catalogued as members of the approved pgcrypto extension from its application-helper sweep, while it still verifies application-defined private functions separately.

Neon also installs global default ACLs created by `cloud_admin` for `neon_superuser` on future tables and sequences. The ACL manifest preserves only those provider grants when the Neon hostname is selected; it continues to reject PUBLIC, runtime, backup, or unclassified application-role defaults.

The migration history also contains two existing clean-deploy quoting defects. `20261002000700_tenant_numbering_annual_effective_date` reads `reset_annually`, while the baseline and Prisma model use `resetAnnually`. `20261003000100_payer_guardian_identity_preflight` references `responsibilityId` without quotes, so PostgreSQL resolves it as `responsibilityid` while both allocation tables use the quoted camel-case column. Rewriting those historical files would break the repository's immutable-checksum rule.

## Decision

Keep the product's existing PostgreSQL shared-schema tenant model and its least-privilege application roles. Add an explicit `managed` database mode for bootstrap and finalization:

- The bootstrap control-plane role must own the selected database and have the managed-provider capabilities required to create the reviewed service/function-owner roles and apply ACLs. It must not be treated as a superuser.
- In managed mode, create each new login role with its configured password and restrictive attributes in the same `CREATE ROLE` statement. Neon requires the password input in plaintext; send it only over verified TLS, keep it in process memory, and never log the SQL or password. Do not use `ALTER ROLE` to change an existing managed login role; credential rotation for an existing role must go through the provider's role-management control plane. If a managed login role already exists, leave its credential unchanged and verify that the configured connection works before application startup.
- For a Neon host, privilege checks explicitly recognize the provider-owned `neon_service` and `neon_superuser` principals. Managed bootstrap does not alter their grants. It still verifies that `PUBLIC`, `fee_runtime`, and `fee_backup` have no database `CREATE`, that runtime/backup cannot create in `public`, and that no application role inherits a provider role. The database owner and Neon provider principals remain trusted infrastructure principals with provider-controlled access.
- Bootstrap changes are confined to the selected database and its newly provisioned application roles. It must not revoke `PUBLIC` privileges or modify ACLs on unrelated databases in the managed cluster.
- `fee_migrator`, `fee_runtime`, `fee_backup`, and non-login function-owner roles remain distinct. The migration role receives temporary database `CREATE` and `app_private` schema `USAGE` while migrations and ACL verification run; the owner-only finalizer removes both before API/worker startup. Runtime and backup receive no schema/database object-creation rights.
- Use the direct Neon endpoint for role bootstrap, staged Prisma migrations, and schema ACL operations. Use the Neon pooled endpoint for the application runtime. Both connections require verified TLS; the runtime URL validator permits only explicitly reviewed schema/TLS/channel-binding parameters and continues rejecting authority overrides.
- The existing local `bundled` mode retains its PostgreSQL-superuser and cluster-wide checks. The two modes are selected explicitly and cannot silently fall back to each other.
- Historical migration files remain immutable and checksum-verified. The selected empty database receives the existing forward-only migration history; no baseline rewrite or reset is permitted.
- Preserve the faulty historical migrations and add forward-only compatibility migrations around them: copy `resetAnnually` to a temporary `reset_annually` column before `20261002000700`, then remove it immediately afterward; copy both allocation tables' `responsibilityId` values to temporary lowercase aliases before `20261003000100`, then remove those aliases immediately afterward. This lets the existing backfill and read-only preflight run on clean databases without changing the domain schema or any applied migration checksum.

## Impact

This adds a managed-provider branch to database role bootstrap/finalization and tests it independently from bundled PostgreSQL. It does not change tenant IDs, tenant scoping, fee/payment behavior, financial history, Prisma models, or the modular-monolith boundaries. It does not make the Neon owner credential available to API, worker, seed, or backup processes.

Neon PostgreSQL 18 is supported by the current Prisma version, but this repository's database integration suite has primarily been exercised against PostgreSQL 17. A successful migration and runtime smoke check on the selected Neon branch will be recorded separately; it is not a substitute for the full PostgreSQL 18 role/ACL, backup/restore, or release QA suite.

## Migration and recovery

1. Perform read-only identity, ownership, version, schema, and relation-count checks before bootstrap.
2. Refuse bootstrap if application relations already exist unless a separately reviewed adoption plan is approved.
3. Provision roles and ACLs in one transaction using the direct endpoint and explicit managed mode.
4. Deploy the immutable staged migrations with the dedicated migration role, then synchronize and verify runtime ACLs.
5. Revoke the migration role's temporary database `CREATE` privilege and verify runtime/backup/PUBLIC privileges before starting the application.
6. If any stage fails, keep API/worker stopped. Inspect `_prisma_migrations` and only use a documented, data-preserving forward recovery. Never drop the branch, reset it, or rewrite applied migration files.

The managed role-creation detail is an implementation adaptation to Neon’s permission boundary; it preserves the existing least-privilege role model. It does not require a schema migration. On an empty target, rerun the atomic bootstrap after read-only verification. If roles already exist, do not reset or replace their passwords in SQL; use the provider role-management workflow and then resume with the dedicated migration credential.

The numbering compatibility migrations are additive history entries only. They preserve the intended backfill for existing rows, remove the temporary alias before subsequent migrations, and leave the Prisma model and final table shape unchanged. No customer fee behavior or financial record is modified.

The payer-identity preflight is a read-only `DO` block. If it fails, confirm its ledger entry and absence of partial DDL, mark only that failed attempt rolled back with Prisma's migration resolver, then rerun the staged forward migration sequence so the compatibility aliases are applied before the preflight. Never mark the preflight applied without running it.

Audit-key provisioning uses its per-version transaction advisory lock to serialize immutable-key insertion. Its existing `SELECT ... FOR UPDATE` unnecessarily required `UPDATE` rights on the key table, which the audit-owner ACL correctly withholds; use a plain `SELECT` under the advisory lock and keep the least-privilege table grant unchanged.

The ACL synchronizer's table-level manifest must reflect the final audit migration: `audit_chain_heads` has table-level `SELECT`/`INSERT`, with `UPDATE` only on the four explicitly mutable head columns. Keep table-level `UPDATE` revoked and let the existing column-privilege check enforce the exact writable set.

The ACL synchronizer must resolve private function identities while connected as the migration role. Grant that role temporary schema `USAGE` for deployment introspection, without granting function `EXECUTE`; the owner-only finalizer revokes `USAGE` and verifies the final state before application startup.

The Neon deployment exposed that catalog inspection of `app_private` routines still used `regprocedure` text conversion and `to_regprocedure`, which require schema `USAGE`; the migration login correctly lacked that privilege after finalization, so ACL sync stopped with SQLSTATE `42501`. Replace those name-resolution calls in the ACL verifier with explicit catalog joins on schema, routine name, and identity arguments, and use the resolved routine OIDs for privilege checks. This keeps the verifier able to inspect ACL metadata without granting migration, runtime, or backup schema access. It changes no database grants or financial/application data. Recovery is to rerun the ACL transaction after the code fix; the prior failed ACL transaction rolled back atomically, and the already-applied migrations/index remain intact.

## Security constraints

- Keep the project-owner URL out of source control and application processes; use it only for one-shot bootstrap/finalization.
- Keep the runtime role on the pooled endpoint and the migration role on the direct endpoint.
- Do not weaken TLS verification or tenant scoping to accommodate a managed database.
- Do not provision customer or demo financial records on the production branch as part of infrastructure setup.
- Treat successful role provisioning as incomplete until grants are verified while connected as the actual runtime and backup roles.

Neon currently gives `PUBLIC` `CONNECT` on provider-owned system databases (`postgres` and the templates). Managed mode deliberately leaves those ACLs unchanged. The application login roles can therefore connect to those system databases, but are not granted any application-schema or table privileges there. The isolated product database has `PUBLIC` `CONNECT`/`TEMP` revoked and explicit service-role grants. The bundled local cluster continues to enforce the stronger no-connect-to-any-other-database check.

Neon's built-in provider roles retain effective database-level privileges on the product database. The managed checks allow only the observed provider role names and only when the selected host is under `.neon.tech`; they do not extend those privileges to `fee_migrator`, `fee_runtime`, or `fee_backup`. The app's runtime and backup logins remain subject to the application-role ACL checks.

## Verification required

- Unit tests prove managed mode validates database ownership/capabilities and leaves bundled mode's superuser checks unchanged.
- SQL integration tests prove the managed bootstrap does not alter unrelated database ACLs and that runtime/migration/backup privileges match the reviewed contract.
- A Neon smoke pass verifies staged migration completion, finalization, API database health, and a runtime login/read path with no owner credential present in the app process.
- Production readiness remains blocked until the architecture's backup/PITR and restore requirements are exercised.

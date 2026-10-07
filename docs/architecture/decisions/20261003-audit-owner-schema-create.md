# Audit owner function-creation privilege

## Status

Proposed implementation decision for the signed audit-chain foundation. It remains subject to the consolidated architecture and security review before audit v2 cutover.

## Context

The v2 audit append, verification, nonce, and tenant-head routines must be `SECURITY DEFINER` functions owned by the non-login `fee_audit_owner`. PostgreSQL requires the target owner to have `CREATE` on the containing schema when a function is created or its owner is changed. Current bootstrap grants `fee_audit_owner` only `USAGE` on `app_private`, so migrations cannot install the required routines under the approved function owner without a narrowly documented privilege change.

## Decision

Grant `USAGE, CREATE` on `app_private` to `fee_audit_owner`. Keep it a non-login role, grant no owner-role membership to runtime or worker, and keep the migration's role switch explicit. The audit owner receives only reviewed row-level operation masks on its audit tables and only the required `pgcrypto` function execution. Runtime continues to receive no `app_private` schema privilege and can execute only the signed API append and tenant-scoped verification wrappers after cutover.

## Impact and migration

- The bootstrap privilege manifest changes from `USAGE` to `USAGE, CREATE` for the non-login audit owner; it adds no business-table privilege by itself and does not rewrite data.
- The migration role can assume the owner role only through its existing non-inheriting, `SET`-only membership. No new credential or login is created.
- ACL synchronization must verify the exact audit-owner schema privilege alongside function/table grants. Runtime, worker, backup, and ordinary migration-role access remain denied.
- Existing installations receive this grant only when the reviewed role-provisioning step is run; revocation is the rollback for the schema privilege, after audit-owned routines have been transferred to an approved replacement owner.

## Review gate

Before v2 cutover, architecture/security review must confirm role membership options, schema privilege scope, function ownership, fixed `search_path`, `PUBLIC` revocation, runtime EXECUTE boundaries, and rollback behavior under the actual PostgreSQL 17 role configuration.

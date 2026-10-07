# ADR — Use Neon for Compose application runtime

**Status:** Accepted for the current Neon-backed development setup  
**Date:** 2026-10-05

## Context

The development launcher already connects the application to Neon, while both
Compose files still started a bundled PostgreSQL service and provisioned local
database roles. This made it easy to start a second, empty database by accident.
The selected Neon project is now the application database for both the local
Compose profile and the production-style Compose template.

## Decision

- Remove bundled PostgreSQL, its data volume declaration, and automatic local
  role provisioning/finalization from both Compose files.
- Keep Redis in Compose because the API and worker use BullMQ/ioredis for
  notification delivery and other queued work.
- The API receives only the Neon `fee_runtime` pooled URL. The migration job
  receives only the direct `fee_migrator` URL and its target/role metadata.
- Neon roles and grants are provisioned and verified through the managed
  database workflow before Compose starts. Compose never creates or alters Neon
  roles.
- Production's one-shot platform bootstrap receives the database owner URL; it
  is not passed to the API, worker, or web services. The encrypted backup job
  uses the separate direct `fee_backup` role. Neon PITR remains the provider
  recovery layer and still requires restore exercises.
- Local Compose does not run schema migrations automatically. Apply the staged
  Neon migration workflow before starting the local application profile. Once
  migrations are current, a one-shot container runs the existing idempotent
  development tenant seeder before the API starts. It uses only `fee_runtime`;
  tenant-admin credentials are passed only to that seed container. When a
  local-only temporary password is configured, it provisions separate admins
  for the demo, school, and academy development workspaces.

## Impact

Compose no longer creates a second PostgreSQL database or stores financial data
in a local PostgreSQL volume. Starting the application requires the Neon runtime
URL; production deployment also requires separate direct migration and
one-shot bootstrap URLs. The seeder preserves existing tenant settings and
accounts. Existing Compose-created database volumes are not
deleted by these file changes. No `docker compose down -v` or volume prune is
part of this change.

The existing bundled PostgreSQL provisioning scripts remain available for
explicit database integration work, but they are not wired into the application
Compose stacks. Domain boundaries, tenant scoping, and financial data rules do
not change.

## Migration and recovery

1. Keep any existing Docker PostgreSQL containers and volumes until their data
   has been inspected and an operator explicitly chooses to remove it.
2. Verify the Neon runtime, migration, backup, and bootstrap credentials and
   confirm the runtime/migration/backup roles and grants exist before deployment.
3. Apply pending schema changes through the staged migration command using the
   direct migration URL.
4. Start the Compose application with the pooled runtime URL. If validation or
   readiness fails, stop application services and correct the Neon settings;
   do not reset the Neon branch or delete an existing volume as a workaround.

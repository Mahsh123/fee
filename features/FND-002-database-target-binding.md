# FND-002 — Bind migration and runtime database targets

## Current implementation

The original bundled-PostgreSQL Compose design recorded below was superseded by
[ADR 20261005 — Neon Compose runtime](../docs/architecture/decisions/20261005-neon-compose-runtime.md).
The active deployment uses Neon and does not create a PostgreSQL Compose service.

- Local Compose API receives only the pooled `fee_runtime` URL. Migration is run
  separately with `npm run db:deploy:neon` and the direct `fee_migrator` URL. Once
  migrations are current, the idempotent development tenant seed runs before API startup.
- Production Compose migration and encrypted backup use direct Neon URLs; runtime
  API uses the pooled URL; one-shot platform bootstrap alone receives the owner URL.
- All configured URLs must refer to the same Neon database and `public` schema. The
  verifier requires verified TLS, channel binding, expected direct/pooled endpoints,
  and distinct credentials. Worker and web services receive no database credentials.
- `npm run test:compose-target` renders both checked-in example configurations and
  rejects bundled database services/volumes, invalid endpoints, and credential leaks.

## Original requirement and findings

The one-shot migration process and API use separate PostgreSQL roles and credentials,
but must connect to the same database endpoint and schema. A migration success on one
database must not authorize an API pointed at another. Historical implementation
reviews identified driver-level URL overrides, Prisma adapter schema handling, and
cross-service credential leakage; the current Neon verifier and staged migration URL
validator enforce the relevant constraints.

## Security and edge cases

- Runtime and migration roles are distinct, and their URLs identify the same database.
- Neon connections require the pooled endpoint for API runtime and the direct endpoint
  for migrations, verified TLS, and channel binding.
- Only supported URL query keys are accepted; duplicate keys and driver-level host,
  port, username, or password overrides fail validation.
- `public` remains required until staged migration/index tooling supports other schemas.
- Runtime, migration, owner/bootstrap, and backup credentials remain isolated by role.
- Errors and verifier summaries do not include connection URLs or passwords.

## Acceptance and verification

- [x] Local and production Compose configurations target Neon without a bundled database.
- [x] Runtime, migration, bootstrap, and backup services use separate Neon credentials.
- [x] Worker and web environments contain no database credentials.
- [x] Compose target tests cover endpoint selection, target drift, TLS, and credential isolation.
- [x] Deployment documentation describes the Neon URLs and migration order.

The earlier bundled-PostgreSQL verification record is historical and is not evidence
that a current Neon production deployment has passed end-to-end or restore testing.

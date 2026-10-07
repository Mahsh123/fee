# Database

PostgreSQL. The database shape is defined in `prisma/schema.prisma`; deployable history is
kept as the ordered additive migrations under `prisma/migrations/`.

## Tenancy

Every tenant-owned table carries `tenantId` and a real foreign key to `tenants`.

```
Platform
  ├── Tenant A ── students, fee_demands, payments, receipts, ledger_entries, …
  ├── Tenant B
  └── Tenant C
```

Isolation is enforced in three places, and never in the frontend:

1. **Token.** The tenant id is a signed claim. A client cannot assert a tenant; it can
   only present a token issued for one. An `X-Tenant-Id` header that disagrees with the
   claim is rejected outright.
2. **Context.** `TenantContextService` opens an `AsyncLocalStorage` scope per request.
   `require()` throws when no scope exists rather than returning `undefined`, so a
   missing context is a loud 500 in development instead of a cross-tenant read in
   production.
3. **Query.** Every repository call filters on the tenant id from that scope.

A shared permission catalogue (`permissions`) is deliberately the one table without a
`tenantId`: which permissions exist is a property of the software. Which roles hold them
(`role_permissions`) is tenant data.

## Money

**Money is never a float.** Every monetary column is `DECIMAL(18,4)`:

```
$ grep -c 'DECIMAL(18,4)' prisma/migrations/20260928000000_init/migration.sql
109
$ grep -Ein '\b(double precision|real|float[48]?)\b' prisma/migrations/*/migration.sql
(no output)
```

Four decimal places, not two, because percentage rules produce exact intermediate values
that must survive a round trip through the database bit-for-bit. Rounding to the
currency's minor units happens once, at presentation and at ledger posting. New tenant
configuration and payer responsibility snapshots use the same decimal representation.

Money crosses the application boundary as a **decimal string** (`"27000.0000"`), never as
a JSON number. A number in JSON is a double, and `0.1 + 0.2` is not a curiosity when the
value is a fee.

Conversion happens at exactly two places: `packages/database/src/money.ts` on the way out
of the database, and `packages/money` inside the domain.

## Constraints

Uniqueness is used as a control, not just as hygiene. These constraints exist to make a
class of bug *impossible* rather than *unlikely*:

| Constraint | Prevents |
|---|---|
| `(tenantId, receiptNumber)` | two receipts sharing a number |
| `(tenantId, invoiceNumber)` | duplicate invoices |
| `(tenantId, provider, environment, providerTxnId)` | the same gateway payment recorded twice |
| partial `(tenantId, provider, environment, externalEventId)` where `signatureValid = true` | a verified webhook processed twice or an invalid event reserving its ID |
| `(tenantId, scope, key)` on `idempotency_keys` | a retried request charging twice |
| `(tenantId, demandNumber)`, `(tenantId, paymentNumber)` | duplicate documents |
| `(demandId, sequence)` on installments | a corrupted installment schedule |
| `(feeTypeId, version)` | version gaps |

Indexes cover the access patterns that matter under load: `(tenantId, status, dueDate)`
for dunning, `(tenantId, studentId, status)` for a student's position, `(tenantId,
paidAt)` for daily collection, `(tenantId, transactionGroupId)` for ledger grouping,
`(tenantId, status, availableAt)` for the outbox pump.

## Immutability

Issued financial records are never edited. Corrections happen through new rows:

| Mistake | Correction |
|---|---|
| wrong amount charged | `adjustments` (CREDIT_ADJUSTMENT / WRITE_OFF) |
| fee should not apply | `waivers` + `adjustments` |
| money returned | `refunds` |
| payment allocated wrongly | reverse the `payment_allocations` row, re-allocate |
| ledger entry wrong | `LedgerService.reverse()` writes mirrored entries |

Configurable objects use `active` / `deletedAt` instead. `fee_types`, `fee_policies`,
`users`, `student_groups` and `sponsors` can be deactivated or archived;
`payments`, `receipts`, `ledger_entries`, `payment_allocations` and `audit_logs` cannot.
Deleting a tenant cascades configuration but is restricted by financial rows, so a tenant
with history cannot be removed - only archived. That is the intended behaviour.

`payer_responsibility_rules` are tenant-owned configuration. Each issued
`fee_demand_responsibilities` row is a tenant-scoped immutable share snapshot; payment and
credit allocations reference those snapshots. Gateway orders store their planned shares
as short-lived reservations so another collection cannot claim the same balance.

## Versioning

Nothing about pricing is mutable in place.

```
fee_types           ──▶ fee_type_versions     (effectiveFrom / effectiveTo)
fee_structures      ──▶ fee_structure_versions ──▶ fee_structure_items
fee_policies        ──▶ fee_policy_versions    ──▶ conditions / actions / scopes
```

An issued `fee_demands` row stores `calculationVersion` and the full calculation
snapshot. Repricing tuition for 2027 cannot change what a 2026 demand said, and any
recalculation is explicit, audited and produces a new version rather than an edit.

## The audit trail is tamper-evident

`audit_logs` is hash-chained per tenant: each row stores `prevHash` and
`hash = SHA256(prevHash + canonicalJson(payload))`. Altering any earlier row breaks every
subsequent hash, so `AuditService.verifyChain()` turns "nobody edited this" from a claim
into evidence.

Audit rows are written in the same transaction as the change they describe, so an action
cannot commit without its record.

## Derived, never stored

Balances are computed from posted transactions:

- `FeeDemand.netAmount - paid - waived - credited` → outstanding
- `deriveDemandStatus()` → the demand's status
- `LedgerService.accountBalance()` → an account balance from posted entries

A stored balance is a second source of truth, and the two will eventually disagree. The
only denormalised figures are on the rows that already own the data (`paidAmount` on a
demand item, `allocatedAmount` on a payment), and they are maintained inside the same
transaction as the allocations that change them.

## Migrations

```bash
npm run db:generate     # regenerate the Prisma client after a schema change
npm run db:migrate      # create and apply a migration (needs a database)
npm run db:deploy       # staged deploy; normally run by the migration service
npm run db:seed         # seed permissions and the platform administrator
```

The staged deploy validates `MIGRATION_DATABASE_URL` against `DATABASE_TARGET_*` before
opening a database connection. `npm run db:deploy:neon` loads the direct Neon migration
URL and target values from `.env`, `.env.neon.local`, and `.env.neon.migration.local`.
Compose does not start PostgreSQL or provision database roles; provision Neon roles and
grants before deployment.

The signed audit bridge is cut over separately with `npm run db:audit-cutover`; the staged
deploy never activates it automatically. Run this only after the audit signing key is
provisioned, wrapper ACL synchronization has succeeded, all API instances using the legacy
audit path are drained, and a pre-cutover backup is available. Set
`AUDIT_CUTOVER_CONFIRM_ALL_API_INSTANCES_USE_SIGNED_AUDIT=true` for that invocation. The
command verifies the active key, serializes against audit writers, locks the audit history,
anchors and verifies every tenant's legacy chain, installs the `audit-chain-v2` marker, and
revokes runtime access to audit tables in one transaction. Any failed check rolls the
transaction back. A repeat invocation checks the cutover ACL state without re-anchoring.
The confirmation flag is an operator assertion; it cannot detect an old API instance that
was left running.

Prisma 7 moved the connection URL out of the schema and into `prisma.config.ts`, and
connects at runtime through the `@prisma/adapter-pg` driver adapter created in
`packages/database/src/client.ts`.

The seed command is idempotent. It creates the reserved `fee-platform` tenant,
global permission catalogue, platform role, and initial operator from
`SEED_PLATFORM_ADMIN_EMAIL` and `SEED_PLATFORM_ADMIN_PASSWORD`. It prefers
`PLATFORM_BOOTSTRAP_DATABASE_URL`, then `MIGRATION_DATABASE_URL`, and only then
`DATABASE_URL`; production passes the separate owner URL to the one-shot
`platform-bootstrap` service and never to the API or worker. After the first seed,
the password can be removed from deployment secrets; rerunning the seed does not
change an existing platform administrator's password.

`npm run dev:neon` separately seeds the development tenant directory and public
branding using the restricted runtime credential. When `SEED_DEMO_PASSWORD` is
set to at least 12 characters, it also creates separate `TENANT_ADMIN` logins
for `demo.localhost`, `school.localhost`, and `academy.localhost`. Email values
default to `admin@demo-academy.test`, `admin@northstar.test`, and
`admin@greenfield-academy.test`; set `SEED_DEMO_EMAIL`, `SEED_SCHOOL_EMAIL`, and
`SEED_ACADEMY_EMAIL` to override them. These accounts are tenant-scoped and are
not platform administrators. Existing account passwords and statuses are
preserved, while the tenant-admin role links are ensured idempotently. The demo
password is sent only to the one-shot development seed process and is never
logged.

The initial schema migration was generated offline with:

```bash
npx prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script
```

so it can be regenerated and diffed without a live database. CI applies it to a real
PostgreSQL instance on every run, which is what proves the migration history produces the
schema the client expects.

## Neon runtime and migration targets in Compose

The API receives the pooled `fee_runtime` URL; the staged migration job receives the
direct `fee_migrator` URL plus non-secret target metadata. The URLs name the same Neon
database and `public` schema. The production-style stack also has a one-shot platform seed
using an owner URL and an encrypted backup service using the separate direct `fee_backup`
role. The owner credential never enters API, worker, or web environments. Local Compose
only needs the pooled runtime URL; schema migration runs separately before containers.

The rendered-config check rejects bundled PostgreSQL services/volumes, role provisioning
containers, weaker Neon TLS, wrong pooled/direct endpoints, or credentials crossing service
boundaries. Connection URLs allow only the supported schema/TLS options; driver-level host,
port, user, and password overrides are rejected. The staged migration/index pipeline
currently requires the `public` schema. See the [Compose runtime decision and recovery
rules](../architecture/decisions/20261005-neon-compose-runtime.md).

Run `npm run test:compose-target` to verify development and production Compose
configurations without starting containers; this uses non-secret checked-in examples.
Before production deployment, run `npm run verify:production-config` against the actual
`.env.production`, or use `npm run deploy:production -- --env-file .env.production`, which
validates that exact file before starting the stack. These commands do not print database
URLs or passwords.

Neon role passwords are configured through the individual connection URLs. Percent-encode
reserved characters (for example, `@` as `%40` and `%` as `%25`). Target fields are not
secrets. A non-Compose deployment must keep the runtime and migration URLs bound to one
target and prevent deployment-only credentials from reaching the API or worker.

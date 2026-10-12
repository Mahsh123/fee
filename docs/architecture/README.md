# Architecture

## Multi-tenant SaaS architecture

The product hierarchy, tenant host model, user and branch scope, provisioning,
subscriptions, entitlements, security, UI requirements, and production acceptance
criteria are tracked in the [multi-tenant SaaS requirements and design](multi-tenant-saas-requirements.md).
The current source audit, end-to-end implementation matrix, and remaining production
gaps are tracked in the [multi-tenant SaaS implementation review](multi-tenant-saas-review.md).
The single-VPS release flow, immutable image tags, off-site encrypted backups,
restore drill, RLS prerequisites, and production monitoring gaps are documented in
the [production deployment and recovery runbook](production-deployment-hardening.md).

## The one principle everything else follows from

A fee platform is not a CRUD application with a `students.fee_amount` column. It is a
record of a sequence of financial events, and each event has to stay separately
explainable years after it happened. The architecture exists to keep six questions
answerable, independently, forever:

```
What the institution configured     fee_types, fee_structures, fee_policies
What was actually demanded          fee_demands, fee_demand_items
Who is responsible for each share   fee_demand_responsibilities
What adjustments were applied       fee_demand_item_adjustments
What operational corrections posted adjustments + balanced ledger entries
What was actually paid              payments
What the payment was allocated to   payment_allocations
What remains outstanding            derived, never stored
```

These are never merged into one table. A balance is always *derived* from the
transactions that produced it, because a stored balance is a second source of truth
and the two will eventually disagree.

Operational corrections do not rewrite the demand, schedule, or issued-invoice
snapshot. Their immutable `Adjustment` records and balanced ledger postings are
canonical; signed `adjustmentAmount` fields are transactionally maintained
projections at those scopes. Outstanding balances are still calculated from the
original amount plus its signed adjustment projection, less payments and waivers.
The decision and additive migration are recorded in
[`20261002-operational-adjustment-projections.md`](decisions/20261002-operational-adjustment-projections.md).

Payer rules split future demand items into immutable responsibility shares. A payer
contribution is separate from a discount, and a pending online order temporarily reserves
the share it plans to collect. The staged migration requirement for adding feature tables
after the original post-index migrations is recorded in
[`20261003-interleaved-migration-stages.md`](decisions/20261003-interleaved-migration-stages.md).

The Prisma baseline's `CREATE SCHEMA` statement requires a short-lived database
`CREATE` privilege. The rollout grants it only to the migration role and revokes it
before application startup; see
[`20261005-prisma-bootstrap-schema-privilege.md`](decisions/20261005-prisma-bootstrap-schema-privilege.md).

Some pre-index migrations need a referenced composite unique key before the normal
index phase. Their declarative, concurrent pre-index barriers are described in
[`20261005-preindex-fk-target-index-barrier.md`](decisions/20261005-preindex-fk-target-index-barrier.md).

For managed Neon PostgreSQL, the bootstrap uses the selected database owner without
assuming superuser access and confines ACL changes to that database. The provider's
system databases remain provider-owned; the application roles may inherit their
default CONNECT permission there, but receive no application-schema or table grants.
See [`20261005-neon-managed-postgres.md`](decisions/20261005-neon-managed-postgres.md).

## Shape

A **modular monolith**, deployed as three processes from one repository:

```
apps/web     Next.js          admin, collection counter, payer portal
apps/api     NestJS           HTTP surface, domain services, all writes
apps/worker  NestJS (headless) receipts, notifications, reminders, reports, retries
```

One database, one deployment, strict internal boundaries. The alternative - a service
per domain on day one - buys independent scaling that nobody needs yet and pays for it
with distributed transactions over money. Extraction is a later, reversible decision;
a wrongly-split financial core is not.

## The fee lifecycle

```
FEE CATALOG         fee_types            what a fee IS
    ↓
FEE STRUCTURE       versioned pricing    what it COSTS for a cohort
    ↓
POLICY / RULES      conditions + actions what REDUCES or INCREASES it
    ↓
FEE ASSIGNMENT      scope + version      WHO is charged
    ↓
FEE DEMAND          per student          how much THEY owe, with the derivation
    ↓
PAYMENT ORDER       intent to pay        gateway-agnostic
    ↓
PAYMENT             immutable record     money actually received
    ↓
PAYMENT ALLOCATION  payment ↔ item       what it settled
    ↓
LEDGER              balanced entries     the accounting record
    ↓
RECEIPT             snapshot document    what the payer was given
    ↓
SETTLEMENT          gateway → bank       reconciliation
    ↓
REPORTING           derived from history never from current balances
```

## Why the stages are ordered the way they are

The engine runs a fixed sequence:

```
BASE → SURCHARGE → SCHOLARSHIP → DISCOUNT → CONCESSION → WAIVER → LIMIT → OVERRIDE → (TAX) → LATE_FEE
```

`(discount then surcharge)` and `(surcharge then discount)` produce different answers
for the same rules. Only one can be authoritative, so the *order* is fixed in code
while the *contents* of each stage - which rules exist, their priority, their
conditions - are entirely tenant data. A tenant controls everything about a rule
except the stage ordering, which would be incoherent to vary.

The order also encodes intent: relief is computed after mandatory charges (so a
scholarship applies to the real cost), caps run after relief (so a floor can claw back
an over-generous discount), a student override runs after caps (because a negotiated
price is the final word), and late fees run last (because a penalty accrues on what is
actually owed).

## Boundaries

Each domain owns its tables and exposes behaviour through a service. Cross-domain
communication is either a direct service call (synchronous, inside one transaction) or
a domain event through the transactional outbox (asynchronous, eventually consistent).

Rules of thumb:

| Concern | Belongs in |
|---|---|
| Money arithmetic | `packages/money` - pure, no I/O |
| Rule evaluation, stacking, explainability | `packages/fee-engine` - pure, no I/O |
| Gateway contracts, state machines, signatures | `packages/payment-contracts` - pure |
| Ledger, numbering, idempotency, audit | `apps/api/common/financial.ts` - transactional |
| Orchestration, persistence, authorisation | domain services in `apps/api/modules` |
| Presentation only | controllers, then the web app |

Nothing in `packages/fee-engine` touches the database, the clock or the network. That
is what makes a calculation reproducible and unit-testable, and it is why the engine
has the highest test density in the repository.

## Concurrency

Two clerks collecting against the same outstanding balance is the failure this system
must make impossible.

```
Outstanding = ₹10,000
Clerk A collects ₹10,000   →  allocated ₹10,000
Clerk B collects ₹10,000   →  rejected, or accepted as a credit IF the tenant
                               explicitly configured overpayment as a credit balance
```

Enforced by four mechanisms, none of which is sufficient alone:

1. `SERIALIZABLE` transactions around any money movement.
2. `SELECT ... FOR UPDATE` on the demand row before revalidating the balance.
3. Unique constraints that make a duplicate impossible: `(tenantId, receiptNumber)`,
   signature-verified webhook events on `(tenantId, provider, environment, externalEventId)`,
   `(tenantId, scope, key)` for idempotency.
4. Idempotency keys on every money-moving endpoint, so a retried request replays its
   original result rather than performing the work again.

## Evolution path

```
Phase 1  Modular monolith                    ← this repository
Phase 2  Extract the payment service         the outbox already carries its events
Phase 3  Extract the notification worker     already a separate process
Phase 4  Extract reporting / analytics       report jobs are already asynchronous
```

The outbox is what makes phase 2 a deployment change rather than a rewrite: events are
already written transactionally alongside the state change that produced them, so a
consumer can move to another process without altering a single producer.

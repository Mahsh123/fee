# FIN-002 — Tenant-configured late-fee accrual

## Scope

Provide tenant-wide late-fee settings and accrue charges as separate demands linked to the overdue demand item. The source demand remains unchanged. Late-fee demand snapshots use a configured fee type and its currently effective published version, including the version's tax settings.

## Domain flow

1. A tenant administrator selects a late-fee mode, grace period, amount/rate/cap, and an active fee type in Institution settings.
2. An authorized staff member runs an accrual through a specific calendar date.
3. Each overdue unpaid item is evaluated against its current outstanding balance by the shared fee engine.
4. The system compares the calculated cumulative charge with prior gross accruals and creates only the positive difference.
5. The accrual record links the source demand item to a new draft fee demand. The new demand contains immutable fee, tax, and calculation snapshots.
6. The draft demand is issued through the normal demand approval flow, which posts its balanced ledger entries.

## Tenant and financial controls

- Every read/write predicate includes `tenantId`; configured fee type and active version are checked inside the transaction.
- A composite tenant foreign key ties the selected fee type and accrual source/result demands to the same tenant.
- `(tenantId, demandItemId, calculatedFor)` makes repeat runs on the same day idempotent.
- Prior gross assessment amounts prevent a waived historical accrual from being silently charged again as if it had never existed.
- Audit and outbox rows commit with each generated draft demand.
- Fee demand and item snapshots retain the selected fee type, version, calculation explanation, tax, and source item identity.

## HTTP surface

- `GET /settings/tenant` — settings, active fee types with effective versions, and academic years.
- `PATCH /settings/tenant` — update tenant-specific currency, payment, localization, approval, reminder, and late-fee configuration.
- `GET /late-fees/accruals` — recent tenant accrual history with source and resulting demand summaries.
- `POST /late-fees/accrue` — process a bounded page using `asOfDate` and optional UUID `cursor`; continue while `hasMore` is true.

## UI

- `/settings` edits tenant configuration, including the linked fee type and tax source.
- `/late-fees` runs date-scoped accrual pages and shows each source-to-result relationship.

## Verification status

Implementation is assembled. The requested consolidated typecheck, tests, tenant/security review, financial review, and migration validation have not yet run; they remain in the end-of-build verification pass.

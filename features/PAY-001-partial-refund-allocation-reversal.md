# PAY-001 — Partial refund allocation reversals

## Architecture issue

The architecture requires partial refunds and immutable payment history. The current schema has `Refund.reversalApplied` and a whole-row `PaymentAllocation.reversedAt`, but neither records the amount of each original allocation that a particular refund reverses. A single boolean cannot account for multiple partial refunds, and marking an entire allocation reversed would reopen too much of a demand.

## Proposed change

Add an immutable `RefundAllocation` child record for each amount a refund removes from an original payment allocation, a payment-backed credit allocation, or an unused payment-backed credit balance. It records tenant, refund, original payment, exactly one source row, demand, demand item, and exact decimal amount. Composite foreign keys enforce tenant equality; runtime validation checks that refund, payment and source rows belong to the same payment, and that cumulative refund-allocation reversals never exceed the source allocation or credit. Keep the original payment and allocation rows unchanged; update demand and credit aggregates only in the same transaction that posts the refund and reversal rows.

## Impact

- Enables correct partial and repeated refunds without editing original payment or credit allocations.
- Allows each refund to be traced to demand items and balanced ledger reversals.
- Adds `Credit.refundedAmount` so a credit's available, allocated, and refunded portions remain reconcilable without changing its original amount.
- Adds one tenant-owned table and indexes; no existing records need backfill because no refund workflow currently writes allocation reversals.
- API, receipt, reports, and reconciliation can show original paid amount separately from cumulative refunds.

## Migration approach

1. Add the `RefundAllocation` model and composite tenant foreign keys to refunds, payment allocations, demands, and demand items.
2. Create the table and supporting indexes through a forward-only migration.
3. Deploy refund writes only after the migration is applied.
4. Verify migration and concurrent refund behavior against PostgreSQL 17 before production rollout.

This is an additive correction to the documented refund lifecycle; it does not change the modular-monolith architecture or any existing payment history.

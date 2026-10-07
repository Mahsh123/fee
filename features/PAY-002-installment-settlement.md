# PAY-002: Installment settlement mapping

## Architecture source

The architecture's Installments section requires custom schedules, partial settlement, and an actual settlement status visible to the student. The Payment Allocation section requires allocations to cover multiple installments and remain explicit and auditable.

## Gap and implementation

Demand generation already snapshots each installment and its fee-item shares, but collection rows were linked only to the demand item. That left installment balances stale after collections and made an exact installment reversal impossible.

Link payment allocations, credit allocations, and installment fee-item snapshots to installments/demand items using tenant-equality foreign keys. During collection, allocate a selected fee item's balance to its scheduled installments in due-date order, allowing partial installment settlement. Preserve any demand-item balance created by later adjustments as an unscheduled remainder. Refunds must reverse the same installment shares recorded on the original allocations.

## Migration

This is an additive migration. It adds nullable composite foreign keys for existing `PaymentAllocation.installmentId` and `InstallmentItem.demandItemId`, and adds the nullable `CreditAllocation.installmentId` field plus its composite foreign key. Existing ledger, payment, demand, and installment history is not rewritten. Existing rows with no installment mapping continue to represent unscheduled demand-item allocations.

## Acceptance criteria

- A payment against a scheduled demand updates the installment item and installment paid amounts in the same transaction as the ledger and demand updates.
- Partial settlement preserves the remaining installment balance and status.
- Allocation ordering follows due date and configured sequence; currency precision remains exact.
- A refund restores the exact installment balances referenced by its source allocations.
- Unscheduled adjustments remain collectible and do not alter prior schedule snapshots.
- Tenant-scoped foreign keys prevent cross-tenant installment or demand-item links.
- Collection receipts continue to snapshot the demand item, method, and amount paid.

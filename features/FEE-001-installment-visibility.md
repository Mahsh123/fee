# FEE-001: Installment schedule visibility

## Architecture source

The architecture's Installments section requires configured due dates, partial settlement, and a visible actual settlement status. The data model describes installment and installment-item snapshots attached to issued demands.

## Scope and rules

Provide a tenant-scoped read endpoint and workspace view for one student's generated schedule. Show the saved amount, amount settled, remaining amount, demand identity, fee-item split, due date, and current status. Derive overdue display status from the due date when a stale persisted status has not yet been refreshed by a worker.

## Security

Require fee-demand read permission and verify the student ID belongs to the authenticated tenant before returning rows. All nested demand, installment-item, and fee-item relationships remain tenant-scoped.

## Acceptance criteria

- Draft or cancelled installments are not presented as collectible schedules.
- Payment and credit applications are reflected through installment-item and installment paid totals.
- Partial refunds restore the original installment balances.
- Displayed remaining amounts use exact decimal arithmetic and cannot become negative.

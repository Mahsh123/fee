# PAY-003: Credit application

## Architecture source

The architecture's Advance Payments and Credit Balance section requires overpayments and advances to remain liabilities until allocated or refunded. The Payment Allocation section requires explicit, auditable allocations. The Installments section requires settlement status to follow actual payments.

## Domain and security rules

- Credit belongs to one tenant and student, has one currency, and maintains `original = available + allocated + refunded`.
- Application may not exceed either selected available credit or the selected student's open fee balance.
- Credit rows and demand items are selected within the authenticated tenant. Expired and exhausted credit is ineligible.
- Available credit and demand balances are consumed in creation/due-date order by default; optional row selections create targeted, auditable choices.
- A credit sourced from a payment moves the source payment's unallocated balance to allocated balance in the same transaction.
- Demand, installment, credit, payment summary, balanced ledger, idempotency, audit, and outbox writes commit atomically.

## API and data changes

Add tenant-scoped list/detail and idempotent apply endpoints using `CreditAllocation` as the immutable allocation record. Installment links use the additive `PAY-002` composite-FK migration. No existing payment or demand history is rewritten.

## Acceptance criteria

- Applying credit reduces available credit and increases allocated credit by the exact same amount.
- The student receivable and credit liability journal lines balance.
- Source payment summaries, demand paid totals, and installment status stay consistent.
- An operation cannot apply more credit than the available amount or fee due.
- Repeating the same idempotency key returns the prior result without duplicating allocations or ledger entries.
- Cross-tenant IDs, expired credits, and mismatched student or currency inputs are rejected.

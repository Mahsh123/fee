# FIN-003 — Demand adjustments and write-offs

## Architecture review and acceptance criteria

### Scope

Provide tenant-scoped credit adjustments, debit adjustments, waivers, write-offs, corrections, approval, ledger posting, and reversals for issued fee-demand items. A financial correction is an append-only `Adjustment` fact; the demand and installment totals below are current balance projections, not replacements for the original amount or adjustment history.

### Data and migration

- Reuse the existing `Adjustment`, `ApprovalRequest`, `LedgerEntry`, tenant sequence, idempotency, audit, and outbox models.
- Add signed `adjustmentAmount` projections to demand items, installment items, installments, and invoices. `FeeDemand.adjustmentAmount` already exists and will be maintained as the demand total. Issued invoice totals and snapshots remain unchanged; the signed projection changes only the current receivable and settlement status.
- Each adjustment selects a fee-demand item. If that item has an installment schedule, it also selects exactly one installment item. This makes schedule effects traceable without rewriting the original scheduled amount.
- Additive migration only: default all new projections to zero. Existing balances and immutable financial facts are unchanged.

### Domain rules

- A positive signed adjustment increases the amount due; a negative adjustment reduces it. It is stored separately from original `netAmount`, `paidAmount`, and engine-generated `waivedAmount`.
- A credit adjustment or write-off cannot exceed the selected item's current outstanding balance. A debit adjustment increases the selected fee item's due amount.
- An adjustment on a scheduled demand must target an installment item. Its signed effect is applied to the demand item, demand, installment item, and installment aggregate in one transaction.
- Approval thresholds come from tenant settings. A pending adjustment cannot affect balances or ledger until approved. Approval and application are atomic.
- Reversals append a compensating adjustment and balanced ledger posting. A debit reversal is rejected if it would reduce the effective fee below amounts already settled.
- Every money-changing request is idempotent. Tenant scope, row versions, balanced ledger entries, audit, and outbox records are enforced transactionally.

### API and UX

- Tenant-protected list and create adjustment endpoints, approval decision endpoint, and reversal endpoint.
- A finance screen shows the demand item, schedule row, amount, reason, kind, status, approval action, and reversal action when allowed.
- No customer-specific adjustment types or amount rules are embedded in code; amounts and threshold behavior are tenant data.

### Security and edge cases

- Every read/write filters by authenticated tenant and every target is reloaded within the transaction.
- Portal-only users cannot access the staff adjustment API.
- Reject adjustments to draft, cancelled, or cross-tenant demands; duplicate idempotency requests with different payloads; duplicate reversals; excessive credits/write-offs; stale concurrent writes; and debited amounts whose reversal would create an overpayment.

### Consolidated verification gate

Implementation is assembled before running tests/builds, per the user's sequencing request. Final verification must cover unit, integration, UI/API, tenant isolation, authorization, idempotency, approval, balanced ledger, schedule projection, concurrent update, rejection, and reversal cases. **Status: implementation in progress; verification intentionally deferred until backend and frontend assembly is complete.**

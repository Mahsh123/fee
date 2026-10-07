# ADR FIN-003: Operational adjustment projections

**Status:** Accepted for implementation; consolidated verification pending  
**Date:** 2026-10-02

## Issue

Issued demand and installment amounts are frozen snapshots. An operational debit, credit, waiver, or write-off must change what remains payable without rewriting those snapshots. Reusing `waivedAmount` would conflate different accounting events, and changing `netAmount` or an issued invoice total would erase the original fact. Installment and invoice readers also need the adjustment effect to remain aligned with the demand.

## Decision

Keep each applied correction in the existing immutable-in-amount `Adjustment` record and post a balanced ledger entry. Add signed `adjustmentAmount` projections to fee-demand items, installments, installment items, and invoices; `FeeDemand.adjustmentAmount` already exists. The projection is updated in the same transaction as the Adjustment and ledger entry. A debit adds to the amount due; a credit reduces it. Current balances are still derived from original amount + signed adjustment projection − paid amount − waiver amount.

For scheduled demand items, each adjustment targets one exact installment item. This preserves the original schedule amount and avoids spreading an approved amount across installments using an undocumented allocation rule. The tenant can post separate adjustments for separate schedule rows.

## Consequences

- Original issue-time amounts, invoice snapshots, payment facts, and ledger rows remain unchanged.
- Payment, credit, refund, late-fee, reminder, report, invoice, installment, and portal readers must use the signed projection in their balance formulas.
- The canonical transaction history remains the Adjustment records and ledger. Projections are not independently editable; every write is atomic and tenant-scoped.
- A debit correction cannot reduce an effective total below amounts already settled when it is later reversed. A credit/write-off cannot reduce a fee item or selected installment below its settled amount.
- The projection columns can be reconciled by summing applied Adjustment rows by target (DEBIT positive, CREDIT negative); a later repair command can be added if production reconciliation requires rebuilding corrupted projections.

## Migration

An additive migration gives new projection columns a zero default and adds the nullable tenant-composite installment target to Adjustment. Existing demands, invoices, and installments keep their original amounts and begin with zero adjustment deltas. No historical row is rewritten or backfilled from heuristics.

## Verification required

The consolidated pass must prove projection equality against applied Adjustment rows, balanced postings, reversals, approvals, concurrency conflicts, invoice and installment balance consistency, tenant isolation, and behavior with legacy zero-delta records. The current runtime database role has not yet been granted business-table DML under DB-002, so deployment remains blocked until the separately tracked DB-001/DB-002 controls permit this audited transaction path.

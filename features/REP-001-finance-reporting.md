# REP-001 — Tenant finance reports

## Scope

The report API derives collection, completed refund, outstanding demand, overdue demand, and fee adjustment totals from posted payment/refund and issued demand records. It is read-only and permission guarded.

## Rules

- Every query includes the authenticated tenant ID.
- Collection dates use the tenant's configured timezone. The selected period is capped at 366 days and invalid dates are rejected.
- Collection totals use successful payment facts; refund totals use completed refund facts. Outstanding balances are current demand balances, separate from period collection totals.
- Monetary values remain decimal strings. The CSV export includes tenant ID, period, timezone, and every displayed report dataset.

## Interface

- `GET /reports/finance?from=YYYY-MM-DD&to=YYYY-MM-DD`
- The tenant workspace provides date filters and CSV export.

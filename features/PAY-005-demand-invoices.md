# PAY-005 — Demand-backed invoices

## Scope

An invoice is issued from one already-issued fee demand. Its tenant-scoped unique demand link prevents duplicate invoices under concurrent requests. The invoice stores an issue-time snapshot of institution branding, student identity, fee breakdown, source demand, dates, totals, and line items. Later branding/configuration changes do not rewrite it.

## Financial behavior

- Draft, cancelled, credited, zero, and negative demands cannot produce a payable invoice.
- A created invoice uses the demand's saved item totals and due date; it does not recalculate fees or policies.
- Invoice `paidAmount` and status are synchronized in the same database transaction when a payment or applied credit changes the demand, and when a refund reverses an allocation.
- Issued snapshot and line data remain unchanged. Existing invoices are returned on a repeat create request.
- Invoices remain tenant scoped, require invoice permissions, and use the tenant's transactional number sequence.

## Interface

- `GET /invoices` lists tenant invoices.
- `GET /invoices/:id` reads an invoice and its saved lines.
- `POST /invoices/from-demand/:demandId` creates or returns the unique invoice for an issued demand.
- The tenant workspace exposes the invoice register, creation flow, print view, status, and balance.

## Persistence

The `(tenantId, demandId)` unique index is additive. PostgreSQL permits multiple `NULL` demand IDs, preserving the existing shape for future non-demand invoices.

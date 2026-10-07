# ADR: Multi-payer responsibility snapshots

## Context

The domain model already recorded who made a payment, but fee demands remained wholly attributable to the student. This could not distinguish a scholarship-fund or sponsor contribution from a fee discount and gave no safe limit for sponsor-specific collection.

## Decision

Add tenant-owned, priority-ordered payer responsibility rules and immutable per-demand-item share snapshots. Apply these after the fee calculation so discounts and waivers remain explicit fee adjustments. The student receives the unassigned remainder. Each payment or credit allocation links to the share it settles, while the existing demand remains the receivable recognized in the tenant ledger.

Pending gateway orders persist their proposed per-share allocations as reservations. Unexpired orders reserve their shares against manual collections and other online checkouts. Refund allocation records reopen the original share rather than editing its snapshot.

Existing open demands are attributed to the student for their unpaid amount at migration time; historical collections remain unchanged. Sponsor and other payer coverage rules apply only when new demands are generated.

## Consequences

- Discounts, scholarships, waivers, and third-party contributions remain separate financial concepts.
- Payment, credit, refund, and gateway-order records can explain exactly which payer responsibility they settle.
- Rule changes do not rewrite generated demands.
- A pending order temporarily reduces the share available to other collections and releases its reservation when it fails or expires.
- Tenant administrators must explicitly configure who funds each fee; the default remains student responsibility.

## Migration

The additive migration creates the rules and snapshot tables, links payment and credit allocations, adds responsibility reservations to payment orders, and assigns existing unpaid balances to the student. No payment, demand total, or ledger entry is rewritten.

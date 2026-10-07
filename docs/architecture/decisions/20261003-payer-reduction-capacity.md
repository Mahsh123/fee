# Payer responsibility capacity after demand reductions

**Status:** Accepted for implementation; consolidated financial verification pending

## Context

Fee demand responsibility rows are immutable snapshots. An operational credit adjustment can reduce the live fee-item balance after those rows were created. Without a shared cap, each payer can independently be shown its original outstanding share, allowing the sum of separate payer checkouts to exceed the live amount due.

## Decision

Keep the original responsibility rows and amounts unchanged as historical evidence. At collection time, derive each row's unreserved collectible amount from its current outstanding share and the fee item's shared remaining capacity.

The capacity is the current fee-item balance less active checkout reservations for that item. Allocate that unreserved capacity in ascending responsibility priority, with stable responsibility ID order for ties. Lower numeric priorities retain their share first; later priorities, including the student's residual responsibility, absorb reductions first. A payer can never be offered more than the capacity left after earlier-priority shares.

Already reserved amounts remain held while their payment orders are active. They count against shared item capacity, so another payer cannot reserve the same capacity. Existing credit-adjustment validation continues to reject a reduction that would consume active reservations.

## Impact

- Existing demand, payment, credit, adjustment, and responsibility rows are not rewritten.
- Existing open demands with shares that exceed the post-adjustment balance become collectable under the priority cap immediately after the new API is deployed.
- Payment and checkout previews may show a reduced or zero share for a later-priority payer after a credit adjustment.
- A successful stale provider capture that no longer fits available capacity must be retained for operator reconciliation, never silently marked as an ordinary processing failure.

## Migration and rollout

No database migration is needed for the capacity calculation. Deploy the API change without rewriting demand snapshots. Add regression coverage for reductions, reservations, priority ties, concurrent payer checkout, and captured payments that exceed the recalculated share. Native PostgreSQL concurrency verification remains required before production rollout.

## Review gate

Architecture, financial/domain, security/tenant-isolation, and QA review must approve the implementation and its tests before this decision is marked complete.

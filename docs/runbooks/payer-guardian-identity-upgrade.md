# Parent/guardian identity upgrade runbook

The guardian identity upgrade adds stable tenant-local guardian references to responsibility rules, issued demand shares, and online orders, plus a tenant-composite guardian foreign key/check for payments. The `Payment.payerGuardianId` scalar predates this upgrade. It deliberately does not map old rows from `payerName`; names can be duplicated, changed, or shared by unrelated people. It also does not rewrite issued demand snapshots.

The migration `20261003000100_payer_guardian_identity_preflight` runs after the guardian ID columns and composite foreign keys exist. It aborts with counts if it finds:

- An active, non-deleted parent/guardian rule whose effective period has not ended and has no guardian ID.
- A collectible unpaid/partially paid demand share whose payer is a parent/guardian and has no guardian ID. Collectibility is capped by the item's current balance after adjustments and by the saved payer priority order.
- A parent/guardian payment order without a guardian ID that remains in `CREATED`, `INITIATED`, or `PENDING`. `expiresAt` alone does not make a locally nonterminal order safe.

## Remediation sequence

1. Run the preflight against a backup/restore rehearsal or the upgrade target before enabling the new API. Use the exception counts to decide which diagnostic queries below to run.
2. For each active legacy rule, use institution-approved identity records to determine the intended tenant-local guardian. Replace the old rule with a guardian-ID-bound rule through an audited remediation procedure; do not choose a guardian by matching a display name. Keep an unresolved rule inactive.
3. Preserve each issued demand share as financial history. Collect its remaining amount on a compatible release before upgrading, or process a separately approved, ledger-backed correction and reissue. Do not update `fee_demand_responsibilities` directly.
4. Resolve active parent/guardian payment orders on the compatible release. Local expiration is not proof that the provider closed checkout or cannot capture. Finance users with `payment.read` and `payment.verify` can check an overdue provider order from Payments; resolve any capture before retrying the migration. PayU capture checks can confirm capture, but failed/unknown PayU attempts and MOCK states cannot release the reservation through this check. There is not yet a scheduled status worker. Treat unresolved legacy parent/guardian orders as a release blocker; see [the provider expiry and late-capture architecture issue](../architecture/decisions/20261003-provider-expiry-and-late-capture.md).
5. Rerun the migration preflight and verify all three counts are zero before starting the new API.

The preflight itself changes no rows. The migration runner must keep the application startup gate closed when the preflight fails. If the institution cannot establish the correct guardian or a financially reviewed correction, stop the upgrade and preserve the existing release until an explicit resolution is approved.

## Read-only diagnostics

List active rules needing an identity decision:

```sql
SELECT "tenantId", id, code, name, "payerType", "effectiveFrom", "effectiveTo"
FROM payer_responsibility_rules
WHERE "payerType" IN ('PARENT', 'GUARDIAN')
  AND "payerGuardianId" IS NULL
  AND active = TRUE
  AND "deletedAt" IS NULL
  AND ("effectiveTo" IS NULL OR "effectiveTo" >= CURRENT_DATE)
ORDER BY "tenantId", code, id;
```

List unresolved shares on collectible demand items:

```sql
SELECT responsibility."tenantId", responsibility.id AS responsibility_id,
       responsibility.demandId, responsibility.demandItemId,
       responsibility."payerType", responsibility.amount,
       demand.currency, item.status AS item_status, demand.status AS demand_status
FROM fee_demand_responsibilities AS responsibility
JOIN fee_demand_items AS item
  ON item."tenantId" = responsibility."tenantId"
 AND item.id = responsibility."demandItemId"
JOIN fee_demands AS demand
  ON demand."tenantId" = responsibility."tenantId"
 AND demand.id = responsibility."demandId"
WHERE responsibility."payerType" IN ('PARENT', 'GUARDIAN')
  AND responsibility."payerGuardianId" IS NULL
  AND item.status IN ('UNPAID', 'PARTIALLY_PAID')
  AND demand.status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE')
ORDER BY responsibility."tenantId", responsibility.demandId, responsibility.demandItemId, responsibility.id;
```

List still-active online orders needing review:

```sql
SELECT "tenantId", id, "orderNumber", "payerType", status, "expiresAt", "createdAt"
FROM payment_orders
WHERE "payerType" IN ('PARENT', 'GUARDIAN')
  AND "payerGuardianId" IS NULL
  AND status IN ('CREATED', 'INITIATED', 'PENDING')
ORDER BY "tenantId", "createdAt", id;
```

The share query intentionally lists candidate historical rows, including shares whose collectible amount is zero after an adjustment or higher-priority share. The migration preflight uses net payment and credit allocations, including refund reversals, then applies the current item balance and priority cap; only a positive payable amount blocks the upgrade. Temporary checkout reservations are not treated as a permanent reduction in a share.

The order diagnostic uses local lifecycle state. A local `EXPIRED`, `FAILED`, or `CANCELLED` status does not prove the provider has closed the order. Until provider-side status verification is implemented, resolve that state with provider evidence and the payment reconciliation process before upgrading legacy parent/guardian orders.

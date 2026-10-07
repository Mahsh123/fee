-- Stop an upgrade from silently making legacy parent/guardian responsibility
-- rows inaccessible. Never infer an authenticated payer identity from a name.
DO $guardian_identity_preflight$
DECLARE
  unresolved_active_rules BIGINT;
  unresolved_open_shares BIGINT;
  unresolved_active_orders BIGINT;
BEGIN
  SELECT COUNT(*)
    INTO unresolved_active_rules
    FROM payer_responsibility_rules
   WHERE "payerType" IN ('PARENT', 'GUARDIAN')
     AND "payerGuardianId" IS NULL
     AND active = TRUE
     AND "deletedAt" IS NULL
     AND ("effectiveTo" IS NULL OR "effectiveTo" >= CURRENT_DATE);

  WITH collectible_items AS (
    SELECT item."tenantId",
           item.id AS "demandItemId",
           GREATEST(item."netAmount" + item."adjustmentAmount" - item."paidAmount" - item."waivedAmount", 0) AS item_balance
      FROM fee_demand_items AS item
      JOIN fee_demands AS demand
        ON demand."tenantId" = item."tenantId"
       AND demand.id = item."demandId"
     WHERE item.status IN ('UNPAID', 'PARTIALLY_PAID')
       AND demand.status IN ('ISSUED', 'PARTIALLY_PAID', 'OVERDUE')
  ), responsibility_balances AS (
    SELECT responsibility."tenantId",
           responsibility.id,
           responsibility."demandItemId",
           responsibility."payerType",
           responsibility."payerGuardianId",
           responsibility.priority,
           item.item_balance,
           GREATEST(
             responsibility.amount - COALESCE(payment_usage.amount, 0) - COALESCE(credit_usage.amount, 0),
             0
           ) AS actual_outstanding
      FROM fee_demand_responsibilities AS responsibility
      JOIN collectible_items AS item
        ON item."tenantId" = responsibility."tenantId"
       AND item."demandItemId" = responsibility."demandItemId"
      LEFT JOIN LATERAL (
        SELECT SUM(GREATEST(allocation.amount - COALESCE(refunds.amount, 0), 0)) AS amount
          FROM payment_allocations AS allocation
          LEFT JOIN LATERAL (
            SELECT SUM(refund_allocation.amount) AS amount
              FROM refund_allocations AS refund_allocation
             WHERE refund_allocation."tenantId" = allocation."tenantId"
               AND refund_allocation."paymentAllocationId" = allocation.id
          ) AS refunds ON TRUE
         WHERE allocation."tenantId" = responsibility."tenantId"
           AND allocation.responsibilityId = responsibility.id
           AND allocation."reversedAt" IS NULL
      ) AS payment_usage ON TRUE
      LEFT JOIN LATERAL (
        SELECT SUM(GREATEST(allocation.amount - COALESCE(refunds.amount, 0), 0)) AS amount
          FROM credit_allocations AS allocation
          LEFT JOIN LATERAL (
            SELECT SUM(refund_allocation.amount) AS amount
              FROM refund_allocations AS refund_allocation
             WHERE refund_allocation."tenantId" = allocation."tenantId"
               AND refund_allocation."creditAllocationId" = allocation.id
          ) AS refunds ON TRUE
         WHERE allocation."tenantId" = responsibility."tenantId"
           AND allocation.responsibilityId = responsibility.id
           AND allocation."reversedAt" IS NULL
      ) AS credit_usage ON TRUE
  ), capacity_before_share AS (
    SELECT balance.*,
           COALESCE(
             SUM(balance.actual_outstanding) OVER (
               PARTITION BY balance."tenantId", balance."demandItemId"
               ORDER BY balance.priority, balance.id
               ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
             ),
             0
           ) AS capacity_consumed_by_higher_priority
      FROM responsibility_balances AS balance
     WHERE balance.actual_outstanding > 0
  )
  SELECT COUNT(*)
    INTO unresolved_open_shares
    FROM capacity_before_share AS share
   WHERE share."payerType" IN ('PARENT', 'GUARDIAN')
     AND share."payerGuardianId" IS NULL
     AND LEAST(
           share.actual_outstanding,
           GREATEST(share.item_balance - share.capacity_consumed_by_higher_priority, 0)
         ) > 0;

  SELECT COUNT(*)
    INTO unresolved_active_orders
    FROM payment_orders
   WHERE "payerType" IN ('PARENT', 'GUARDIAN')
     AND "payerGuardianId" IS NULL
     AND status IN ('CREATED', 'INITIATED', 'PENDING');

  IF unresolved_active_rules > 0 OR unresolved_open_shares > 0 OR unresolved_active_orders > 0 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Guardian identity preflight blocked the upgrade; legacy payer data needs explicit remediation.',
      DETAIL = FORMAT(
        'Unmapped active rules: %s; collectible open shares: %s; active online orders: %s.',
        unresolved_active_rules,
        unresolved_open_shares,
        unresolved_active_orders
      ),
      HINT = 'Follow docs/runbooks/payer-guardian-identity-upgrade.md. Do not map by display name or rewrite issued demand snapshots.';
  END IF;
END
$guardian_identity_preflight$;

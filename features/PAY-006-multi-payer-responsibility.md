# PAY-006 — Multi-payer demand responsibility

## Scope

Configure tenant-owned rules that split future fee demand items between the student and named third-party or family payers. Preserve the split on the demand and restrict collections to each payer's available responsibility.

## Domain behavior

- Rules may target all students, one student, or one student group, and may optionally scope to an academic year and fee type.
- Payers may be parents, guardians, sponsors, government programmes, scholarship funds, institutions, or other named third parties. The student is the automatic residual payer.
- Rules run in ascending priority, then stable identity order. Fixed values are per applicable fee item; percentage values apply to the remaining amount after higher-priority shares. No share can exceed that remainder.
- Coverage is applied after fee calculation, discounts, concessions, waivers, and tax. A third-party contribution therefore stays distinct from a discount or waiver.
- Demand generation writes an item-level payer, amount, sponsor identity, source rule, and priority snapshot. Editing or deactivating a rule never changes prior demand snapshots.
- Payment and credit allocations reference the responsibility snapshot they settle. A payer cannot collect more than its remaining share; the student's available balance also absorbs new unassigned debit adjustments.
- Open gateway orders reserve their intended responsibility shares until success, failure, or expiry. Manual and other gateway collections see those reservations, preventing concurrent collection of the same share. Pending third-party reservations do not inflate the student's residual balance.
- Student credits apply only against the student's unreserved balance. A balance-reducing operational adjustment is held until active checkout reservations for that fee item finish or expire, protecting an amount already presented to an external gateway.
- Refund allocation reversals reopen the original responsibility share. Student credit application is limited to the student's own share.
- Existing open demands are backfilled to the student at their current unpaid balance. Their historical paid amount is not re-attributed to a newly configured sponsor.

## Security and audit

- Rules, sponsors, students, groups, fee types, years, demand snapshots, allocations, and orders are tenant-scoped.
- Rule reads and configuration use separate `payer.responsibility.read` and `payer.responsibility.configure` permissions.
- Rule create, activation, and deactivation record audit/outbox events. Financial shares and reservations are frozen per demand/order.
- Portal users may select the student share; a linked parent may pay a parent/guardian share only under their tenant-scoped guardian identity.

## Guardian identity upgrade gate

The additive guardian-ID migration does not infer identities from `payerName` or rewrite issued responsibility snapshots. A post-index preflight blocks deployment while an active parent/guardian rule lacks an identity, a collectible parent/guardian demand share lacks an identity after current-balance and priority caps, or a locally nonterminal parent/guardian order lacks an identity. Legacy inactive rules can remain stored but cannot be reactivated until a tenant-local guardian is linked. A manual provider-status check is available for overdue nonterminal orders, but there is no scheduled worker and locally terminal legacy orders cannot currently be checked through that route. Keep those records as a release gate; see [the provider expiry and late-capture architecture issue](../docs/architecture/decisions/20261003-provider-expiry-and-late-capture.md) and [the upgrade runbook](../docs/runbooks/payer-guardian-identity-upgrade.md).

## HTTP and UI

- `GET /payer-responsibility-rules`
- `POST /payer-responsibility-rules`
- `PATCH /payer-responsibility-rules/:id` — activate/deactivate only
- `/payer-responsibilities` configures future coverage rules.
- `/payments` shows and collects only the selected payer's open responsibility; online orders save their responsibility reservation.
- Fee demand detail includes the saved item-level responsibility snapshot.

## Acceptance criteria

- [x] Configure fixed or percentage shares for a student/group/year/fee scope.
- [x] Preserve responsibility snapshots with each generated demand item.
- [x] Keep payer contribution accounting separate from benefit discounts and waivers.
- [x] Filter manual and gateway collection by the payer and prevent over-collection.
- [x] Reserve payer shares against concurrent online orders and manual collection.
- [x] Apply student credit only to student responsibility; reverse responsibility settlement when a refund is posted.
- [x] Bind parent/guardian rules, demand snapshots, orders, and payments to stable tenant-local guardian IDs; prevent ambiguous legacy rules from being reactivated without a tenant-local identity.
- [ ] Verify the legacy-data upgrade gate against adjusted/priority-capped shares and provider-verified order closure. The SQL and fixture changes are assembled; PostgreSQL 17 execution, automated checking, and local-terminal legacy order handling remain open.
- [ ] Run tenant isolation, authorization, financial invariant, migration, API, UI, and concurrency verification during the consolidated final pass.

## Verification status

Implementation and prior review fixes are assembled, including the adjusted-share preflight correction. The latest migration/query fixture changes have not yet been verified; run the consolidated workspace and PostgreSQL 17 checks, then complete the independent architecture, tenant/security, financial, and QA reviews before marking this feature complete. Manual provider-side checking now covers overdue nonterminal orders for supported providers; automated checking and legacy orders already marked locally terminal remain release blockers documented in the architecture issue. Native PostgreSQL, role/ACL, and concurrency verification require the CI database because the local Docker engine is unavailable.

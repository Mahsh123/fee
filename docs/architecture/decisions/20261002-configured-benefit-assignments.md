# Configured benefit assignments

**Status:** Accepted for assembly; consolidated verification pending

## Context

Scholarship, discount, concession, waiver, surcharge and student-group assignment tables existed in the schema, but they had no staff API/UI and were not loaded by demand generation. Fee policies already use the pure `RuleDefinition` contract and snapshot every applied line in the issued demand.

## Decision

Expose the existing tenant-owned instruments and benefit assignments through one permissioned Benefits module. Active, effective student and group assignments are converted to deterministic rule definitions per generation batch and evaluated by the existing fee engine. The engine remains pure and database-independent. Assignment stacking mode and priority are configuration fields, because ordering is a tenant decision. Surcharges are tenant-wide dated instruments restricted to configured fee types; conditional or cohort-specific charges remain expressible with fee policies. The existing `FeeOverride` record is also surfaced as a student-scoped, effective-dated rule, with overlapping pending or active overrides rejected.

Approval-required assignments stay pending and are excluded from calculations until approval. Issued demand calculation JSON and adjustment rows preserve the actual instrument, dates, reason, approval identity and applied amount; later configuration changes affect future demands only.

## Data and migration

Add `stackingMode` and `priority` to `BenefitAssignment`, plus effective lookup indexes. Add approval/order configuration and a lookup index to `Surcharge`. The migration is additive with defaults that preserve all existing rows.

## Consequences and verification

No service boundary or fee-engine contract changes. The backend and Benefits screen are assembled. Consolidated verification still needs to prove migration/client parity, assignment approval and isolation, group and academic-year filtering, fee-type restrictions, stage/stacking behavior, ledger/report categorization, and immutable snapshots. The current database runtime ACL remains a separate deployment blocker.

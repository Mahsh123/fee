# BEN-001 — Configurable benefits and awards

## Purpose and architecture

Expose tenant-defined scholarships, discounts, concessions, waivers and surcharges, then let authorized staff assign the supported relief instruments to a student or group. Provide dated, approval-aware per-student price overrides as well. Fee calculation remains in the pure fee engine; active assignments are flattened into deterministic, explainable rules at demand generation time. Issued demands retain their calculation and adjustment snapshots.

## Database and financial rules

- Reuse the existing instrument and `BenefitAssignment` tables; add configurable assignment `stackingMode` and `priority` with safe defaults.
- Reuse `FeeOverride` for immutable-before-issue per-student price exceptions; prevent overlapping active or pending overrides for the same fee type and period.
- An assignment points to exactly one student or one tenant-owned student group and exactly one supported instrument. An optional academic year narrows eligibility.
- Assignment and instrument effective windows must overlap. Their intersection determines when the generated rule is eligible.
- Instrument amounts and fee-type restrictions remain tenant configuration. Assignment overrides may tighten percentage, fixed amount and maximum.
- Approval-required instruments create `PENDING_APPROVAL` assignments. They affect no demand until approved. Approval/rejection/archive decisions are audited; generated demand snapshots never change when configuration is later edited.
- Scholarships, discounts, concessions, waivers and surcharges remain separate calculation stages and report categories. No relief rewrites the original fee.

## API and UI

- Tenant-scoped CRUD for instrument configuration and list/create/decision/archive for assignments.
- Tenant-scoped override creation, approval/archive and read APIs use their dedicated override permissions.
- A single finance screen exposes instrument setup, student/group assignment, approval queue and assignment history with permission-gated actions.
- The demand generator loads direct and group assignments per student and passes deterministic instrument-backed rules to the existing engine.

## Security and edge cases

- Every tenant-owned reference is validated inside the write transaction. Student, group, fee type, academic year, and instrument references from another tenant are rejected.
- Reject invalid amount combinations, fee-type references, overlapping effective ranges, duplicate/missing instrument references, stale approval decisions, inactive instruments, and attempts to edit an assignment after approval.
- Audits include before/after configuration and approval decisions. Existing demand snapshots remain immutable.

## Acceptance criteria

- Staff can configure all five instrument families and assign student/group relief with dates, fee scope, priority, stacking, and optional amount caps.
- Approval-gated assignments have no calculation effect until approved.
- Demand generation applies only active, date-effective assignments in the exact tenant/year/student/group scope and records instrument provenance in the calculation snapshot.
- Demand generation applies only approved, date-effective overrides for the exact student, fee type and academic year; the saved original amount, target amount and reason remain explainable.
- Deactivation/archive affects future demand generation only.
- Consolidated verification covers unit/integration/UI, tenant isolation, authorization, approval state, effective dates, stacking, amount bounds, and immutable issued snapshots.

## Verification status

Backend, UI, schema, and demand-engine wiring are being assembled together. Tests, client generation, migration validation, and independent reviews are deferred to the consolidated pass requested for this build.

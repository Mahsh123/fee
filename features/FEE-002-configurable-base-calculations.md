# FEE-002 — Configurable base calculation methods

## Architecture issue found before implementation

The architecture lists `FIXED`, `PERCENTAGE`, `QUANTITY`, `USAGE`, `FORMULA`, and `CUSTOM` fee methods, and requires versioned, reproducible fee calculations. It does not define how the last three methods receive their calculation inputs or how a tenant configures their formula. The current API accepts these method values, but demand generation rejects `USAGE`, `FORMULA`, and `CUSTOM` because no provider contract is stored with a fee type version. As a result, the advertised configuration cannot produce a demand.

## Proposed additive design

- Add nullable `calculationConfig` JSON to `FeeTypeVersion`, the existing immutable effective-dated configuration snapshot.
- Define a versioned, validated expression schema for configurable calculations. Expressions are bounded arithmetic/selection nodes over an allowlisted calculation context; arbitrary JavaScript, SQL, network access, and tenant-supplied code are never executed.
- `USAGE` resolves a configured numeric fact path from the evaluated student/context snapshot and applies the configured structure unit rate. `FORMULA` and `CUSTOM` resolve a configured expression using structure amount, quantity, percentage base, student/custom facts, fee facts, and academic-year facts.
- Persist the exact calculation config, resolved inputs, and evaluated base amount in the generated demand calculation snapshot. Subsequent edits only affect future fee type versions/demands.
- Keep the current pure fee engine and modular monolith; the evaluator is a deterministic capability within the fee-engine package, not a customer-specific provider or service boundary.
- A published fee type version's calculation fields remain immutable. Its open-ended effective window may be closed once through an authorized, reasoned, audited lifecycle action so a successor version can take effect without overlap; already generated demand snapshots remain unchanged.
- Published fee structure versions follow the same forward-only window-closure rule: an open active version may have its effective end set once, with an authorized reason and audit/outbox event, so a future immutable schedule can supersede it. Issued demand snapshots are not rewritten.

## Impact and migration

- Database: one nullable `jsonb` column on `fee_type_versions`, added with a forward-only additive migration. Existing rows remain unchanged and `NULL` means no extra config for legacy methods.
- API/validation: accept and validate a typed calculation config on initial and subsequent fee type versions; require valid config before publishing methods that need one. Add explicit close-window actions for active fee type and fee structure versions; do not silently amend the old formula or schedule when publishing a successor.
- Calculation: pass the immutable fee type version config and per-student calculation context to the pure evaluator. Generated calculation JSON already stores the result and therefore continues to be the historical source of truth.
- UI: add guided configuration inputs for usage fact selection and formula operations, with validation feedback, plus a clear active-version close action. Keep the existing structure amount/quantity fields as the rate and structure-level inputs. The student profile supports tenant-defined typed attributes that can supply numeric formula/usage facts.
- Security/tenant: configuration is versioned per tenant and read through the existing tenant-scoped fee version query. Runtime ACLs must not grant direct writes to posted demand or calculation snapshots except through the existing reviewed domain path.
- Rollout: deploy the additive migration before the API that reads the new field. Old API binaries ignore the nullable column; new binaries preserve existing versions and reject only attempts to publish a newly configured method without valid input.

## Acceptance criteria

- A tenant can configure a usage source and safe formula without application code changes.
- `FIXED`, `PERCENTAGE`, and `QUANTITY` retain their current deterministic behavior.
- Missing, malformed, excessively deep, non-numeric, divide-by-zero, or out-of-range formula input fails before any demand rows commit.
- The generated calculation snapshot includes the config version, resolved input values, and exact result for audit/reproduction.
- The same snapshot and context always produce the same amount with exact decimal arithmetic.
- Verification covers method boundaries, malformed trees, arithmetic safety, concurrent configuration publication, cross-tenant fact access, snapshot immutability, and UI/API flows in the consolidated final pass.

## Status

Implementation in progress. The proposal also records why the existing version-overlap rule needs a one-time audited effective-window close action: without it, the first open-ended published version could never be superseded. This change leaves fee calculation snapshots immutable and only controls future applicability. This proposal is recorded before changing the schema or calculation contract, as required by the architecture's change-control instruction. No independent reviews or consolidated tests have run for this slice.

The additive versioned config column, safe arithmetic evaluator, demand calculation snapshot provenance, fee catalog configuration UI, and audited fee type and structure version-window closure paths are assembled. Fee structures now have a multi-item editor for new schedules and successor versions, including tax, due-date, quantity, percentage-base, and optionality settings. Fee-structure quantity/base/due-date fields, student custom numeric attributes, and per-model runtime grants are also assembled. Fee calculation previews and demand generation now require an explicit tenant currency rather than silently assuming INR; the same fail-closed rule applies to manual collection, credit application, and online orders. A captured gateway event whose tenant currency is missing or differs from the order is retained as unapplied evidence. Client generation is complete. This batch's unit/integration/E2E tests and independent reviews are intentionally deferred until backend/frontend assembly is complete.

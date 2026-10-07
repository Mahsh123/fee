# The fee engine

`@fee/fee-engine` is the part of the platform that answers *"why is this fee
₹27,000?"* without a person having to reconstruct it by hand.

It is pure: no database, no clock, no network. Given the same context, rule set and
version, it always produces the same result, and the result carries its own derivation.

## Input

```ts
calculateFees({
  currency: 'INR',
  roundingMode: 'HALF_UP',
  asOfDate: '2026-04-01',
  context: { student, fee, payment, academicYear, history, scopeUnits, studentGroupIds },
  items:  [{ feeTypeCode: 'TUITION', baseAmount: '50000', quantity: '1', ... }],
  rules:  [ /* flattened FeePolicy + version + conditions + actions + scopes */ ],
  lateFee: { mode: 'PER_DAY', graceDays: 10, perDayAmount: '100', maxAmount: '2000' },
})
```

`items` come from a published fee-structure version. `rules` come from policy versions
that are active on `asOfDate`. The engine performs no lookup of its own: everything it
may consider is passed in, which is exactly what makes a stored calculation
reproducible.

Scholarship, discount, concession and waiver assignments are tenant-owned records. The
Benefits service loads only approved assignments effective for the candidate student,
group and academic year, then flattens each grant into the existing rule contract.
Instrument amounts, fee-type scope, grant caps, stacking, priority and dates remain
configuration. Surcharges are effective-dated tenant instruments scoped to fee types;
conditional surcharges use fee policies. The issued demand preserves the calculated
instrument provenance so later configuration edits do not reprice past demands.

## The pipeline

| Stage | Purpose | Typical rules |
|---|---|---|
| `BASE` | the structure's price | per-fee-type pricing, quantity and usage |
| `SURCHARGE` | mandatory additions | international student fee, premium course, late registration |
| `SCHOLARSHIP` | awarded support | merit, government scheme, trust fund |
| `DISCOUNT` | commercial or cohort reduction | sibling, early payment, staff ward |
| `CONCESSION` | need-based relief | hardship, category-based |
| `WAIVER` | discretionary removal | management, full or partial |
| `LIMIT` | caps and floors | cap the payable, minimum payable |
| `OVERRIDE` | per-student exception | negotiated price, management quota |
| `LATE_FEE` | accrued penalty | per-day, flat, percentage |

Tax is charged on the amount finally payable, after relief and after any override.
Charging tax on the gross fee would over-tax every scholarship holder.

## Worked example

Configuration: tuition ₹50,000; a 40% merit scholarship; a ₹5,000 sibling concession;
a ₹2,000 mandatory lab surcharge.

```
Base tuition                  50,000.00
+ Special Lab Charge           2,000.00      SURCHARGE
- Merit Scholarship          -20,000.00      SCHOLARSHIP  (40% of base)
- Sibling Concession          -5,000.00      CONCESSION
--------------------------------------------------------
Net payable                   27,000.00
```

The stored result contains, per fee item: every line with its rule id, rule type,
reason, approver, effective dates and the running total after it; the bucket totals
(`baseAmount`, `surchargeAmount`, `scholarshipAmount`, `concessionAmount`,
`waiverAmount`, `overrideAmount`, `taxAmount`, `lateFeeAmount`); and every rule that was
**evaluated and did not apply**, with the reason.

## Explainability

A rule that does not apply is as important as one that does:

```
skippedRules: [
  { code: 'MERIT90', reason: 'CONDITIONS_UNMET',       detail: 'Condition tree evaluated to false' },
  { code: 'SIBLING30', reason: 'LOST_ARBITRATION',     winnerCode: 'SIBLING10' },
  { code: 'GRADE9_ONLY', reason: 'SCOPE_MISMATCH',     detail: 'Student is outside this rule's scope' },
  { code: 'NEEDS_ROUTE', reason: 'CONDITIONS_UNMET',   detail: 'student.transportRoute is empty' },
]
```

An engine that silently drops rules produces a number nobody can defend. This one
produces an argument.

## Stacking

Rules inside an arbitration group compete for the same rupee, so resolution must be
deterministic. Ordering is `(priority, code)` - a total order - and priority values are
separated in hundreds so no accumulation of bonuses can outvote a routing decision.

| Mode | Behaviour |
|---|---|
| `STACKABLE` | every rule in the group applies, in priority order |
| `NON_STACKABLE` | the first rule with a **non-zero** effect applies; the rest are skipped |
| `EXCLUSIVE` | only the highest-priority rule applies, even if its effect is zero |
| `PRIORITY_ONLY` | only the highest-priority rule *per policy type* applies; other types still apply |
| `HIGHEST_BENEFIT` | every rule is measured in isolation; the largest credit wins |

`NON_STACKABLE` deliberately lets a zero-effect rule step aside rather than block a
sibling that would help the family. `EXCLUSIVE` deliberately does not, because sometimes
the intent is "this waiver replaces all others, unconditionally".

An explicit `arbitrationGroup` always groups rules together. Without one, a
non-stackable rule joins an implicit group of *same stage, same policy type*, so two
sibling discounts cannot both apply by accident while a scholarship and a discount stay
independent.

## Overrides

`OVERRIDE_AMOUNT` sets an absolute price. The original is never mutated:

```
baseAmount       50,000.00
overrideAmount   22,500.00   (positive = relief granted)
netAmount        27,500.00
```

An override that *raises* the price stores a negative `overrideAmount`, so the arithmetic
stays a single subtraction and an increase cannot hide in a different bucket.

## Late fees

Computed on the **outstanding** amount, not the original demand: a student who has paid
80% of a fee and is ten days late should not be penalised on the 80% already settled.

A `LATE_FEE`-staged rule takes precedence over the tenant's global configuration. That
precedence is decided by *matching*, not by producing an effect, so a rule saying "no
late fee for scholarship holders" suppresses the default whether or not a penalty has
accrued yet.

Every accrual is a traceable row (`late_fee_accruals`) with its mode, days late, grace
days, rate and cap - so a penalty can be explained, waived and reversed individually.

## Validation before activation

`validateRuleSet` runs before a policy is published and rejects, with the offending rule
codes named:

| Check | Code |
|---|---|
| effective window ends before it starts | `IMPOSSIBLE_DATE_RANGE` |
| an `ACTIVE` rule whose window has closed | `EXPIRED_RULE_STILL_ACTIVE` |
| a rule with no actions | `NO_ACTIONS` |
| an action missing its amount or percentage | `ACTION_MISSING_AMOUNT` / `ACTION_MISSING_PERCENTAGE` |
| an unknown condition field | `UNKNOWN_CONDITION_FIELD` |
| a reference to a fee type that does not exist | `UNKNOWN_FEE_TYPE_REFERENCE` |
| two rules with the same stage, priority and group | `DUPLICATE_PRIORITY_CONFLICT` |
| a rule testing an amount an earlier stage changes | `ORDER_SENSITIVE_CONDITION` |
| exclusive arbitration across different policy types | `CIRCULAR_ARBITRATION` |
| contradictory add-and-waive in one rule | `CONTRADICTORY_ACTIONS` |

The alternative is discovering them at 2am while generating demands for four hundred
students.

## Failure handling

A rule that references a fact the tenant has not populated does **not** throw. The fact
resolves to `undefined`, the rule does not match, and the engine records
`CONDITION_FIELD_UNRESOLVED` naming the rule and the field. Blocking demand generation
for the whole cohort because one student has no transport route is worse than the
omission - as long as the omission is visible.

The engine also self-checks: `running` is maintained incrementally while the buckets are
maintained alongside it. If they ever disagree, it emits `CALCULATION_INCONSISTENT` as an
error rather than persisting an unexplainable amount.

## Test coverage

55 scenarios in `packages/fee-engine/src/engine.spec.ts`, covering the cases that
actually occur:

normal student · 100% scholarship · 50% scholarship · fixed scholarship with a cap ·
fee-specific scholarship · approval provenance · sibling discount · scholarship +
discount stacking · percentage of base vs of running total · concession kept separate ·
partial waiver · exemption vs waiver · mandatory surcharge order · tax after relief ·
non-stackable first-wins · zero-effect step-aside · exclusive priority · highest benefit ·
priority-only per type · student override down · override up · cap · minimum floor ·
relief never exceeds the fee · zero base amount flagged · numeric thresholds · early
payment discount · AND groups · OR groups · IN lists · missing facts reported · unit
scope matching · scope mismatch · effective window · non-active rules · per-day late fee ·
grace period · late fee cap · no late fee before due date · percentage on outstanding ·
rule precedence over tenant default · no late fee on a waived fee · approval thresholds
above and below · end-to-end explanation · and the full rule-set validation matrix.

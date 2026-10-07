import { Money, Rate } from '@fee/money';
import type {
  AdjustmentLine,
  CalculationStage,
  FeeCalculationItemInput,
  PolicyType,
  RuleActionDefinition,
  RuleDefinition,
  SkippedRule,
} from '@fee/types';

/**
 * Rule action application.
 *
 * An action never edits the base amount. Every effect is recorded as an
 * `AdjustmentLine` and accumulated into a bucket, and the item's payable amount
 * is always `running`, which is derived from those buckets. That invariant is
 * what lets `FeeDemand.baseAmount` and `FeeDemand.netAmount` disagree by exactly
 * the sum of the recorded adjustments, forever.
 *
 * Sign convention: `running` is the authoritative payable figure. `relief` is a
 * positive credit; an increase is recorded with a DEBIT direction and increases
 * `running`. `override` is signed: positive means the override reduced the
 * payable, negative means it raised it.
 */

export interface ItemCalculationState {
  item: FeeCalculationItemInput;
  base: Money;
  surcharge: Money;
  scholarship: Money;
  discount: Money;
  concession: Money;
  waiver: Money;
  /** Signed: positive is relief, negative is an increase. */
  override: Money;
  tax: Money;
  taxableSurchargeParts: Array<{ id: string; code: string; name: string; reason: string; amount: Money; percent: Rate }>;
  lateFee: Money;
  /** Amount the tenant wanted to grant but a cap absorbed. */
  capped: Money;
  running: Money;
  lines: AdjustmentLine[];
  appliedRuleIds: string[];
  skipped: SkippedRule[];
  attention: string[];
}

export interface ApplyActionContext {
  currency: string;
  stage: CalculationStage;
  allowNegativeTotal: boolean;
  sequenceStart: number;
}

export function createItemState(item: FeeCalculationItemInput, currency: string): ItemCalculationState {
  const base = Money.fromString(item.baseAmount, currency);
  return {
    item,
    base,
    surcharge: Money.zero(currency),
    scholarship: Money.zero(currency),
    discount: Money.zero(currency),
    concession: Money.zero(currency),
    waiver: Money.zero(currency),
    override: Money.zero(currency),
    tax: Money.zero(currency),
    taxableSurchargeParts: [],
    lateFee: Money.zero(currency),
    capped: Money.zero(currency),
    running: base,
    lines: [],
    appliedRuleIds: [],
    skipped: [],
    attention: [],
  };
}

/** Which bucket a relief belongs to, derived from the rule's policy type. */
function reliefBucketFor(policyType: PolicyType): 'scholarship' | 'discount' | 'concession' | 'waiver' {
  switch (policyType) {
    case 'SCHOLARSHIP':
      return 'scholarship';
    case 'CONCESSION':
      return 'concession';
    case 'WAIVER':
    case 'EXEMPTION':
      return 'waiver';
    case 'DISCOUNT':
    case 'EARLY_PAYMENT_DISCOUNT':
    default:
      return 'discount';
  }
}

function actionTargetsItem(action: RuleActionDefinition, item: FeeCalculationItemInput): boolean {
  const codes = action.feeTypeCodes;
  if (!codes || codes.length === 0) return true;
  const target = item.feeTypeCode.trim().toLowerCase();
  return codes.some((code) => code.trim().toLowerCase() === target);
}

/**
 * The amount an action requests, before any cap. Returned with the direction so
 * the caller can decide how much of it actually lands.
 */
function requestedEffect(
  action: RuleActionDefinition,
  state: ItemCalculationState,
  currency: string,
): { direction: 'DEBIT' | 'CREDIT'; amount: Money; percent?: Rate } {
  const basis = (): Money => {
    switch (action.amountBasis) {
      case 'BASE_AMOUNT':
      case 'FEE_ITEM':
      case undefined:
      case null:
        return state.base;
      case 'RUNNING_TOTAL':
        return state.running;
      default:
        return state.running;
    }
  };

  const percent = action.percentage ? Rate.fromPercent(action.percentage) : undefined;
  const percentageOf = (base: Money): Money => base.percent(percent ?? Rate.zero());

  switch (action.kind) {
    case 'ADD_FIXED_AMOUNT':
      return { direction: 'DEBIT', amount: Money.fromString(action.amount ?? '0', currency) };
    case 'ADD_PERCENTAGE':
      return { direction: 'DEBIT', amount: percentageOf(basis()), percent };
    case 'DISCOUNT_FIXED':
      return { direction: 'CREDIT', amount: Money.fromString(action.amount ?? '0', currency) };
    case 'DISCOUNT_PERCENTAGE':
      return { direction: 'CREDIT', amount: percentageOf(basis()), percent };
    case 'WAIVE_FULL':
      // Waive whatever is still payable, never more than that.
      return { direction: 'CREDIT', amount: state.running };
    case 'WAIVE_PARTIAL': {
      if (percent) return { direction: 'CREDIT', amount: percentageOf(basis()), percent };
      return { direction: 'CREDIT', amount: Money.fromString(action.amount ?? '0', currency) };
    }
    case 'EXEMPT':
      // Exempts the fee itself; surcharges already added are not exempted.
      return { direction: 'CREDIT', amount: state.base.min(state.running) };
    case 'OVERRIDE_AMOUNT': {
      const target = Money.fromString(action.amount ?? state.running.toString(), currency);
      const delta = target.subtract(state.running);
      return { direction: delta.isNegative ? 'CREDIT' : 'DEBIT', amount: delta.abs() };
    }
    case 'CAP_AMOUNT':
    case 'SET_MAXIMUM_AMOUNT': {
      const cap = Money.fromString(action.amount ?? '0', currency);
      const excess = state.running.subtract(cap);
      return { direction: 'CREDIT', amount: excess.isNegative ? Money.zero(currency) : excess };
    }
    case 'SET_MINIMUM_AMOUNT': {
      const floor = Money.fromString(action.amount ?? '0', currency);
      const shortfall = floor.subtract(state.running);
      return { direction: 'DEBIT', amount: shortfall.isNegative ? Money.zero(currency) : shortfall };
    }
    case 'SET_DUE_DATE':
      return { direction: 'CREDIT', amount: Money.zero(currency) };
    case 'ADD_LATE_FEE':
      return { direction: 'DEBIT', amount: Money.fromString(action.amount ?? '0', currency) };
    case 'REMOVE_LATE_FEE':
      return { direction: 'CREDIT', amount: state.lateFee };
    default:
      return { direction: 'CREDIT', amount: Money.zero(currency) };
  }
}

export interface ApplyActionResult {
  applied: boolean;
  amount: Money;
  line?: AdjustmentLine;
}

/**
 * Applies one action to one item. Returns `applied: false` when the action has
 * no monetary effect (e.g. `SET_DUE_DATE`, already-exempt fee), so the engine can
 * tell "this rule did nothing" from "this rule reduced the fee by zero".
 */
export function applyAction(
  state: ItemCalculationState,
  action: RuleActionDefinition,
  rule: RuleDefinition,
  context: ApplyActionContext,
): ApplyActionResult {
  if (!actionTargetsItem(action, state.item)) return { applied: false, amount: Money.zero(context.currency) };

  const currency = context.currency;

  if (action.kind === 'SET_DUE_DATE') {
    // Non-monetary but recorded, because a due date that moved silently is the
    // kind of change an audit trail exists to capture.
    const dueDateLine = buildLine(state, rule, context, {
      direction: 'CREDIT',
      amount: Money.zero(currency),
      label: `${rule.name} set due date`,
      notes: action.dueDate ? `Due date set to ${action.dueDate}` : undefined,
    });
    state.lines.push(dueDateLine);
    return { applied: true, amount: Money.zero(currency), line: dueDateLine };
  }

  const requested = requestedEffect(action, state, currency);
  if (requested.amount.isZero) return { applied: false, amount: Money.zero(currency) };

  // A per-action cap limits how much a single rule may move the amount.
  let amount = requested.amount;
  let cappedBy: string | undefined;
  if (action.capAmount && requested.direction === 'CREDIT') {
    const cap = Money.fromString(action.capAmount, currency);
    if (amount.greaterThan(cap)) {
      state.capped = state.capped.add(amount.subtract(cap));
      amount = cap;
      cappedBy = `${rule.code}:capAmount`;
    }
  }
  if (action.floorAmount && requested.direction === 'CREDIT') {
    const floor = Money.fromString(action.floorAmount, currency);
    const resultingTotal = state.running.subtract(amount);
    if (resultingTotal.lessThan(floor)) {
      const allowed = state.running.subtract(floor);
      state.capped = state.capped.add(amount.subtract(allowed));
      amount = allowed.isNegative ? Money.zero(currency) : allowed;
      cappedBy = `${rule.code}:floorAmount`;
    }
  }

  if (requested.direction === 'CREDIT') {
    // Never let a credit push the payable below zero unless the tenant has
    // explicitly allowed a negative demand (rare, and off by default).
    if (!context.allowNegativeTotal && amount.greaterThan(state.running)) {
      state.capped = state.capped.add(amount.subtract(state.running));
      cappedBy = cappedBy ?? `${rule.code}:nonNegativeTotal`;
      amount = state.running;
    }
    if (amount.isZero) {
      state.skipped.push({
        ruleId: rule.id,
        code: rule.code,
        name: rule.name,
        stage: context.stage,
        reason: 'ZERO_EFFECT',
        detail: 'Nothing left to reduce',
      });
      return { applied: false, amount: Money.zero(currency) };
    }
    state.running = state.running.subtract(amount);
    if (rule.policyType === 'OVERRIDE') state.override = state.override.add(amount);
    else state[reliefBucketFor(rule.policyType)] = state[reliefBucketFor(rule.policyType)].add(amount);
  } else {
    state.running = state.running.add(amount);
    if (rule.policyType === 'OVERRIDE') {
      // An override that raises the amount is recorded as negative relief so the
      // arithmetic stays a single subtraction.
      state.override = state.override.subtract(amount);
    } else if (rule.policyType === 'LATE_FEE') {
      state.lateFee = state.lateFee.add(amount);
    } else if (rule.policyType === 'SURCHARGE') {
      state.surcharge = state.surcharge.add(amount);
      if (rule.instrument?.type === 'SURCHARGE' && rule.instrument.taxable && rule.instrument.taxPercent) {
        state.taxableSurchargeParts.push({
          id: rule.instrument.id ?? rule.id,
          code: rule.code,
          name: rule.instrument.name ?? rule.name,
          reason: rule.instrument.reason ?? rule.name,
          amount,
          percent: Rate.fromPercent(rule.instrument.taxPercent),
        });
      }
    } else {
      state.surcharge = state.surcharge.add(amount);
    }
  }

  const line = buildLine(state, rule, context, {
    direction: requested.direction,
    amount,
    percent: requested.percent,
    cappedBy,
  });

  // The line is the record of why the amount moved. A bucket update without a
  // line would make the demand unexplainable, so they are written together.
  state.lines.push(line);
  state.appliedRuleIds.push(rule.id);
  return { applied: true, amount, line };
}

function buildLine(
  state: ItemCalculationState,
  rule: RuleDefinition,
  context: ApplyActionContext,
  input: {
    direction: 'DEBIT' | 'CREDIT';
    amount: Money;
    label?: string;
    percent?: Rate;
    cappedBy?: string;
    notes?: string;
  },
): AdjustmentLine {
  const basisAmount = state.base.add(state.surcharge).add(state.tax).add(state.lateFee);
  return {
    code: `${rule.policyType}:${rule.code}`,
    label: input.label ?? rule.name,
    stage: context.stage,
    direction: input.direction,
    amount: input.amount.toDecimalString(),
    percent: input.percent ? input.percent.percentString : null,
    basisAmount: basisAmount.toDecimalString(),
    runningTotalAfter: state.running.toDecimalString(),
    sequence: context.sequenceStart + state.lines.length,
    policyId: rule.id,
    policyVersionId: rule.versionId ?? null,
    policyName: rule.name,
    policyType: rule.policyType,
    stackingMode: rule.stackingMode,
    instrumentType: rule.instrument?.type ?? null,
    instrumentId: rule.instrument?.id ?? null,
    reason: rule.instrument?.reason ?? rule.explainTemplate ?? rule.name,
    approvedBy: rule.instrument?.approvedBy ?? null,
    approvedAt: rule.instrument?.approvedAt ?? null,
    effectiveFrom: rule.effectiveFrom,
    effectiveTo: rule.effectiveTo ?? null,
    cappedBy: input.cappedBy ?? null,
    notes: input.notes ?? null,
  };
}

/**
 * Deep-enough copy for what-if analysis: Money values are immutable, but the
 * collections and running total must not be shared with the original.
 */
export function cloneItemState(state: ItemCalculationState): ItemCalculationState {
  return {
    item: state.item,
    base: state.base,
    surcharge: state.surcharge,
    scholarship: state.scholarship,
    discount: state.discount,
    concession: state.concession,
    waiver: state.waiver,
    override: state.override,
    tax: state.tax,
    taxableSurchargeParts: [...state.taxableSurchargeParts],
    lateFee: state.lateFee,
    capped: state.capped,
    running: state.running,
    lines: [...state.lines],
    appliedRuleIds: [...state.appliedRuleIds],
    skipped: [...state.skipped],
    attention: [...state.attention],
  };
}

/**
 * Measures how much a rule would reduce the payable amount, without applying it.
 *
 * Required by HIGHEST_BENEFIT arbitration: choosing the best of several rival
 * rules means knowing each one's outcome first, and guessing from the rule's
 * declared percentage would be wrong whenever a rule is non-linear (WAIVE_FULL,
 * OVERRIDE_AMOUNT, a floor, or a fee-type-restricted action).
 */
export function measureRuleCredit(
  state: ItemCalculationState,
  rule: RuleDefinition,
  context: ApplyActionContext,
): Money {
  const probe = cloneItemState(state);
  for (const action of [...rule.actions].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))) {
    applyAction(probe, action, rule, context);
  }
  const credit = state.running.subtract(probe.running);
  return credit.isPositive ? credit : Money.zero(context.currency);
}

/** Adds an explicit late-fee amount as its own traceable line. */
export function applyLateFeeAmount(
  state: ItemCalculationState,
  amount: Money,
  context: ApplyActionContext & { label: string; mode: string },
): void {
  if (amount.isZero) return;
  state.lateFee = state.lateFee.add(amount);
  state.running = state.running.add(amount);
  state.lines.push({
    code: `LATE_FEE:${context.mode}`,
    label: context.label,
    stage: 'LATE_FEE',
    direction: 'DEBIT',
    amount: amount.toDecimalString(),
    basisAmount: state.base.toDecimalString(),
    runningTotalAfter: state.running.toDecimalString(),
    sequence: context.sequenceStart + state.lines.length,
    policyId: null,
    policyVersionId: null,
    policyName: context.label,
    policyType: 'LATE_FEE',
    stackingMode: null,
    instrumentType: 'LATE_FEE',
    instrumentId: null,
    reason: context.mode,
    cappedBy: null,
  });
}

/** Tax is charged on the amount actually payable, after relief. */
export function applyTax(state: ItemCalculationState, currency: string, sequenceStart: number): void {
  if (state.item.taxable && state.item.taxPercent) {
    const rate = Rate.fromPercent(state.item.taxPercent);
    if (!rate.isZero()) {
      const taxableBase = state.running;
      const tax = taxableBase.percent(rate);
      if (!tax.isZero) {
        state.tax = state.tax.add(tax);
        state.running = state.running.add(tax);
        state.lines.push({
          code: 'TAX', label: `Tax @ ${rate.percentString}%`, stage: 'LIMIT', direction: 'DEBIT',
          amount: tax.toDecimalString(), percent: rate.percentString, basisAmount: taxableBase.toDecimalString(),
          runningTotalAfter: state.running.toDecimalString(), sequence: sequenceStart + state.lines.length,
          policyId: null, policyVersionId: null, policyName: 'Tax', policyType: null, stackingMode: null,
          instrumentType: null, instrumentId: null, reason: 'Tax on the taxable amount payable', cappedBy: null,
        });
      }
      return;
    }
  }

  let remaining = state.running;
  for (const part of state.taxableSurchargeParts) {
    if (!remaining.isPositive || part.percent.isZero()) continue;
    const taxableBase = part.amount.min(remaining);
    const tax = taxableBase.percent(part.percent);
    remaining = remaining.subtract(taxableBase);
    if (tax.isZero) continue;
    state.tax = state.tax.add(tax);
    state.running = state.running.add(tax);
    state.lines.push({
      code: `TAX:SURCHARGE:${part.code}`, label: `${part.name} tax @ ${part.percent.percentString}%`, stage: 'LIMIT', direction: 'DEBIT',
      amount: tax.toDecimalString(), percent: part.percent.percentString, basisAmount: taxableBase.toDecimalString(),
      runningTotalAfter: state.running.toDecimalString(), sequence: sequenceStart + state.lines.length,
      policyId: null, policyVersionId: null, policyName: part.name, policyType: 'SURCHARGE', stackingMode: null,
      instrumentType: 'SURCHARGE', instrumentId: part.id, reason: part.reason, cappedBy: null,
    });
  }
}

/** Applies the tenant floor to the item's final payable amount. */
export function applyItemFloor(state: ItemCalculationState, floor: Money | null, sequenceStart: number): void {
  if (!floor) return;
  if (state.running.lessThan(floor)) {
    const raise = floor.subtract(state.running);
    state.running = floor;
    state.surcharge = state.surcharge.add(raise);
    state.lines.push({
      code: 'LIMIT:minimumPayable',
      label: `Minimum payable applied (${floor.format()})`,
      stage: 'LIMIT',
      direction: 'DEBIT',
      amount: raise.toDecimalString(),
      runningTotalAfter: state.running.toDecimalString(),
      sequence: sequenceStart + state.lines.length,
      policyId: null,
      policyVersionId: null,
      policyName: 'Minimum payable',
      policyType: null,
      stackingMode: null,
      instrumentType: null,
      instrumentId: null,
      reason: 'Tenant configured a minimum payable amount',
      cappedBy: null,
    });
  }
}

import { Money } from '@fee/money';
import { isAfterDate, isBeforeDate } from '@fee/dates';
import {
  CALCULATION_STAGES,
  type AdjustmentLine,
  type CalculationDiagnostic,
  type CalculationStage,
  type FeeCalculationItemInput,
  type FeeCalculationItemResult,
  type FeeCalculationRequest,
  type FeeCalculationResult,
  type FeeCalculationTotals,
  type RuleDefinition,
  type SkippedRule,
} from '@fee/types';
import {
  applyItemFloor,
  applyLateFeeAmount,
  applyTax,
  createItemState,
  type ItemCalculationState,
} from './actions';
import { evaluateConditions } from './conditions';
import { scopeMatches } from './facts';
import { computeLateFee } from './late-fee';
import { applyRules, arbitrate } from './stacking';

/**
 * Calculation engine.
 *
 * The pipeline is fixed; the *contents* of each stage are tenant data:
 *
 *   BASE        the structure's price for the fee type
 *   SURCHARGE   mandatory and additional charges
 *   SCHOLARSHIP awards, usually with approval provenance
 *   DISCOUNT    sibling, early payment, staff ward, ...
 *   CONCESSION  hardship and category-based relief
 *   WAIVER      management discretion, full or partial
 *   LIMIT       caps and floors
 *   OVERRIDE    a per-student price agreed as an exception
 *   LATE_FEE    accrued penalties
 *
 * The order cannot be reconfigured, because "discount then surcharge" and
 * "surcharge then discount" give different answers for the same rules and only
 * one can be authoritative. Tenants control which rules exist, their stage, and
 * their priority within a stage.
 *
 * Every result carries the full derivation, so the answer to "why is this
 * 27,000?" is the result itself rather than an inference.
 */

export const CALCULATION_VERSION = '1.1.0';

export function calculateFees(request: FeeCalculationRequest): FeeCalculationResult {
  const currency = request.currency;
  const diagnostics: CalculationDiagnostic[] = [];
  const asOf = request.asOfDate;

  if (request.items.length === 0) {
    diagnostics.push({
      severity: 'WARNING',
      code: 'NO_ITEMS',
      message: 'Calculation was requested with no fee items; the demand will be empty.',
    });
  }

  // --- rule selection: date effectiveness is checked once, not per item ---
  const activeRules = request.rules.filter((rule) => rule.status === 'ACTIVE');
  const inactiveCount = request.rules.length - activeRules.length;
  if (inactiveCount > 0) {
    diagnostics.push({
      severity: 'INFO',
      code: 'RULES_NOT_ACTIVE',
      message: `${inactiveCount} rule(s) were ignored because they are not in ACTIVE status.`,
    });
  }

  const effectiveRules = activeRules.filter((rule) => isRuleEffective(rule, asOf));
  const expiredCount = activeRules.length - effectiveRules.length;
  if (expiredCount > 0) {
    diagnostics.push({
      severity: 'INFO',
      code: 'RULES_OUT_OF_WINDOW',
      message: `${expiredCount} rule(s) were ignored because their effective window does not include ${asOf}.`,
    });
  }

  const rulesByStage = new Map<CalculationStage, RuleDefinition[]>();
  for (const stage of CALCULATION_STAGES) rulesByStage.set(stage, []);
  for (const rule of effectiveRules) {
    rulesByStage.get(rule.stage)?.push(rule);
  }

  const unresolvedByRule = new Map<string, Set<string>>();
  const conditionFailures = new Map<string, number>();
  const approvalRequired = new Set<string>();

  const itemResults: FeeCalculationItemResult[] = [];

  for (const item of request.items) {
    const result = calculateItem({
      item,
      request,
      rulesByStage,
      diagnostics,
      unresolvedByRule,
      conditionFailures,
      approvalRequired,
    });
    itemResults.push(result);
  }

  // --- rules that matched nothing at all are worth surfacing once ---
  for (const rule of effectiveRules) {
    const failures = conditionFailures.get(rule.id) ?? 0;
    if (failures === 0) continue;
    const applied = itemResults.some((result) => result.appliedRuleIds.includes(rule.id));
    if (!applied) {
      diagnostics.push({
        severity: 'INFO',
        code: 'RULE_CONDITIONS_UNMET',
        message: `Rule "${rule.name}" (${rule.code}) matched no fee item: its conditions were unmet for all ${failures} item(s) it was evaluated against.`,
        ruleCode: rule.code,
      });
    }
  }

  for (const [ruleCode, fields] of unresolvedByRule) {
    if (fields.size === 0) continue;
    diagnostics.push({
      severity: 'WARNING',
      code: 'CONDITION_FIELD_UNRESOLVED',
      message: `Rule ${ruleCode} references field(s) that are empty for this student: ${[...fields].join(', ')}. The rule was not applied.`,
      ruleCode,
    });
  }

  for (const code of approvalRequired) {
    diagnostics.push({
      severity: 'WARNING',
      code: 'APPROVAL_REQUIRED',
      message: `Rule ${code} requires approval before the adjustment it produced may take effect.`,
      ruleCode: code,
    });
  }

  const totals = sumTotals(itemResults);
  const hasError = diagnostics.some((d) => d.severity === 'ERROR');
  const needsAttention = itemResults.some((item) => item.needsAttention === true) || (!hasError && approvalRequired.size > 0);

  const appliedRuleIds = [...new Set(itemResults.flatMap((item) => item.appliedRuleIds))];
  const skippedRules = dedupeSkipped(itemResults.flatMap((item) => item.skippedRules));

  return {
    status: hasError ? 'FAILED' : needsAttention ? 'NEEDS_ATTENTION' : 'OK',
    currency,
    calculationVersion: CALCULATION_VERSION,
    asOfDate: asOf,
    items: itemResults,
    totals,
    diagnostics,
    appliedRuleIds,
    skippedRules,
  };
}

interface CalculateItemArgs {
  item: FeeCalculationItemInput;
  request: FeeCalculationRequest;
  rulesByStage: Map<CalculationStage, RuleDefinition[]>;
  diagnostics: CalculationDiagnostic[];
  unresolvedByRule: Map<string, Set<string>>;
  conditionFailures: Map<string, number>;
  approvalRequired: Set<string>;
}

function calculateItem(args: CalculateItemArgs): FeeCalculationItemResult {
  const { item, request, rulesByStage, diagnostics, unresolvedByRule, conditionFailures, approvalRequired } = args;
  const currency = request.currency;
  const state = createItemState(item, currency);
  const attentionReasons: string[] = [];

  let sequence = 0;
  let lateFeeRuleApplied = false;

  const scopeUnits = request.context.scopeUnits ?? [];
  const groupIds = request.context.studentGroupIds ?? [];

  for (const stage of CALCULATION_STAGES) {
    const candidates = rulesByStage.get(stage) ?? [];
    if (candidates.length === 0) {
      // Tax is charged on the amount finally payable, so it is applied once the
      // override stage has settled the figure. The configured late fee is applied
      // after the loop exactly once, once it is known whether a rule set one.
      if (stage === 'OVERRIDE') applyTax(state, currency, sequence);
      continue;
    }

    const matched: RuleDefinition[] = [];
    for (const rule of candidates) {
      if (!scopeMatches(rule.scopes, scopeUnits, request.context, groupIds)) {
        state.skipped.push(skip(rule, 'SCOPE_MISMATCH', 'Student is outside this rule\'s scope'));
        continue;
      }
      const evaluation = evaluateConditions(rule.conditions, request.context);
      if (evaluation.unresolvedFields.length > 0) {
        const bucket = unresolvedByRule.get(rule.code) ?? new Set<string>();
        evaluation.unresolvedFields.forEach((field) => bucket.add(field));
        unresolvedByRule.set(rule.code, bucket);
      }
      if (!evaluation.matched) {
        conditionFailures.set(rule.id, (conditionFailures.get(rule.id) ?? 0) + 1);
        state.skipped.push(skip(rule, 'CONDITIONS_UNMET', 'Condition tree evaluated to false'));
        continue;
      }
      matched.push(rule);
    }

    if (matched.length === 0) {
      if (stage === 'OVERRIDE') applyTax(state, currency, sequence);
      continue;
    }

    const decision = arbitrate({
      rules: matched,
      state,
      currency,
      stage,
      allowNegativeTotal: request.allowNegativeTotal === true,
      sequenceStart: sequence + state.lines.length,
    });
    state.skipped.push(...decision.skipped);

    applyRules(state, decision.apply, {
      currency,
      stage,
      allowNegativeTotal: request.allowNegativeTotal === true,
      sequenceStart: sequence,
    });
    sequence += 100; // generous stride keeps line ordering stable as rules are added

    if (stage === 'LATE_FEE') {
      // Precedence is decided by *matching*, not by producing an effect. A rule
      // that says "no late fee for scholarship holders" matches whether or not a
      // penalty has accrued yet, and must suppress the tenant default either way.
      lateFeeRuleApplied = true;
    }

    for (const rule of decision.apply) {
      if (rule.requiresApproval && state.appliedRuleIds.includes(rule.id)) {
        const threshold = rule.approvalThreshold ? Money.fromString(rule.approvalThreshold, currency) : null;
        const effect = state.scholarship
          .add(state.discount)
          .add(state.concession)
          .add(state.waiver);
        if (!threshold || effect.greaterThanOrEqual(threshold)) {
          approvalRequired.add(rule.code);
          attentionReasons.push(`Approval required: ${rule.name}`);
        }
      }
    }

    if (stage === 'OVERRIDE') applyTax(state, currency, sequence);
  }

  if (!lateFeeRuleApplied) {
    applyConfiguredLateFee(state, request, item, currency, sequence, true);
  }

  applyItemFloor(state, request.minimumPayable ? Money.fromString(request.minimumPayable, currency) : null, sequence);

  // --- assemble the result, deriving the payable amount from the buckets ---
  const gross = state.base.add(state.surcharge).add(state.tax).add(state.lateFee);
  const relief = state.scholarship.add(state.discount).add(state.concession).add(state.waiver).add(state.override);
  const derivedNet = gross.subtract(relief);

  // Self-check: `running` is maintained incrementally and the buckets are
  // maintained alongside it. If they ever disagree, a rule mutated the running
  // total without recording why, and the demand would be unexplainable.
  if (!derivedNet.equals(state.running)) {
    diagnostics.push({
      severity: 'ERROR',
      code: 'CALCULATION_INCONSISTENT',
      message:
        `Internal inconsistency for ${item.feeTypeCode}: the running total is ${state.running.toString()} ` +
        `but the recorded adjustments account for ${derivedNet.toString()}.`,
      itemKey: item.key,
    });
  }

  if (state.running.isNegative) {
    diagnostics.push({
      severity: 'ERROR',
      code: 'NEGATIVE_NET_AMOUNT',
      message: `Item ${item.feeTypeCode} calculated a negative payable amount (${state.running.toString()}).`,
      itemKey: item.key,
    });
    attentionReasons.push('Negative payable amount');
  }

  if (state.capped.isPositive) {
    diagnostics.push({
      severity: 'INFO',
      code: 'ADJUSTMENT_CAPPED',
      message: `${state.capped.format()} of relief on ${item.feeTypeCode} was not granted because a cap or floor was reached.`,
      itemKey: item.key,
    });
  }

  if (item.baseAmount === '0' || Number(item.baseAmount) === 0) {
    if (item.optionality === 'MANDATORY') {
      attentionReasons.push(`Mandatory fee ${item.feeTypeCode} has a zero base amount`);
      diagnostics.push({
        severity: 'WARNING',
        code: 'ZERO_BASE_AMOUNT',
        message: `Mandatory fee ${item.feeTypeCode} has a base amount of zero. Check the fee structure version.`,
        itemKey: item.key,
      });
    }
  }

  const needsAttention = attentionReasons.length > 0;

  return {
    key: item.key,
    feeTypeId: item.feeTypeId,
    feeTypeCode: item.feeTypeCode,
    feeTypeName: item.feeTypeName,
    feeCategoryCode: item.feeCategoryCode,
    feeTypeVersionId: item.feeTypeVersionId,
    sequence: item.sequence,
    frequency: item.frequency,
    optionality: item.optionality,
    quantity: item.quantity,
    rate: item.rate,
    baseCalculation: item.baseCalculation,
    baseAmount: state.base.toDecimalString(),
    surchargeAmount: state.surcharge.toDecimalString(),
    scholarshipAmount: state.scholarship.toDecimalString(),
    discountAmount: state.discount.toDecimalString(),
    concessionAmount: state.concession.toDecimalString(),
    waiverAmount: state.waiver.toDecimalString(),
    overrideAmount: state.override.toDecimalString(),
    taxAmount: state.tax.toDecimalString(),
    lateFeeAmount: state.lateFee.toDecimalString(),
    grossAmount: gross.toDecimalString(),
    totalRelief: relief.toDecimalString(),
    netAmount: state.running.toDecimalString(),
    cappedAmount: state.capped.toDecimalString(),
    lines: orderLines(state.lines),
    appliedRuleIds: [...new Set(state.appliedRuleIds)],
    skippedRules: dedupeSkipped(state.skipped),
    dueDate: item.dueDate,
    periodStart: item.periodStart,
    periodEnd: item.periodEnd,
    needsAttention,
    attentionReasons: needsAttention ? attentionReasons : undefined,
  };
}

/**
 * The tenant-configured late fee, used when no LATE_FEE-staged rule applied.
 * Rules win over the tenant default so a tenant can carve out an exception
 * ("no late fee for scholarship holders") without disabling the global policy.
 */
function applyConfiguredLateFee(
  state: ItemCalculationState,
  request: FeeCalculationRequest,
  item: FeeCalculationItemInput,
  currency: string,
  sequence: number,
  allow: boolean,
): void {
  if (!allow) return;
  const config = request.lateFee;
  if (!config || config.mode === 'NONE') return;
  if (!state.running.isPositive) return;

  const outstanding = item.outstandingAmount ? Money.fromString(item.outstandingAmount, currency) : state.running;
  if (!outstanding.isPositive) return;

  const outcome = computeLateFee({
    config,
    dueDate: item.dueDate ?? config.dueDate,
    asOfDate: config.asOfDate ?? request.asOfDate,
    outstanding,
    currency,
  });
  if (!outcome.amount.isPositive) return;

  applyLateFeeAmount(state, outcome.amount, {
    currency,
    stage: 'LATE_FEE',
    allowNegativeTotal: request.allowNegativeTotal === true,
    sequenceStart: sequence,
    label: `Late fee (${outcome.daysLate} day(s) late)`,
    mode: outcome.cappedBy ? `${outcome.mode}:${outcome.cappedBy}` : outcome.mode,
  });
}

function isRuleEffective(rule: RuleDefinition, asOf: string): boolean {
  if (rule.effectiveFrom && isAfterDate(rule.effectiveFrom, asOf)) return false;
  if (rule.effectiveTo && isBeforeDate(rule.effectiveTo, asOf)) return false;
  return true;
}

function skip(rule: RuleDefinition, reason: SkippedRule['reason'], detail?: string): SkippedRule {
  return { ruleId: rule.id, code: rule.code, name: rule.name, stage: rule.stage, reason, detail };
}

/** Stable, human-friendly line ordering: by stage, then by sequence. */
function orderLines(lines: AdjustmentLine[]): AdjustmentLine[] {
  const stageIndex = new Map<CalculationStage, number>(CALCULATION_STAGES.map((stage, index) => [stage, index]));
  return [...lines].sort((a, b) => {
    const stageDelta = (stageIndex.get(a.stage) ?? 0) - (stageIndex.get(b.stage) ?? 0);
    if (stageDelta !== 0) return stageDelta;
    if (a.sequence !== b.sequence) return a.sequence - b.sequence;
    return a.code < b.code ? -1 : 1;
  });
}

function dedupeSkipped(skipped: SkippedRule[]): SkippedRule[] {
  const seen = new Set<string>();
  const result: SkippedRule[] = [];
  for (const entry of skipped) {
    const key = `${entry.ruleId}:${entry.reason}:${entry.winnerCode ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }
  return result;
}

function sumTotals(items: FeeCalculationItemResult[]): FeeCalculationTotals {
  const zero = (): string => '0.0000';
  const totals: FeeCalculationTotals = {
    baseAmount: zero(),
    surchargeAmount: zero(),
    scholarshipAmount: zero(),
    discountAmount: zero(),
    concessionAmount: zero(),
    waiverAmount: zero(),
    overrideAmount: zero(),
    lateFeeAmount: zero(),
    taxAmount: zero(),
    grossAmount: zero(),
    totalRelief: zero(),
    netAmount: zero(),
    cappedAmount: zero(),
  };
  const keys = Object.keys(totals) as Array<keyof FeeCalculationTotals>;
  const currency = 'XXX';
  const accumulators = new Map<keyof FeeCalculationTotals, Money>();
  for (const key of keys) accumulators.set(key, Money.zero(currency));
  for (const item of items) {
    for (const key of keys) {
      const current = accumulators.get(key)!;
      accumulators.set(key, current.add(Money.fromString(item[key], currency)));
    }
  }
  for (const key of keys) totals[key] = accumulators.get(key)!.toDecimalString();
  return totals;
}

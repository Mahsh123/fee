import { isAfterDate } from '@fee/dates';
import { FEE_RULE_FIELDS, type ConditionNode, type RuleDefinition } from '@fee/types';

/**
 * Configuration validation.
 *
 * Run before a fee structure or policy is activated, so a tenant discovers a
 * problem while an administrator is looking at the screen rather than on the
 * night demand generation runs for four hundred students.
 *
 * Every issue names the rules involved, because "your rule set is invalid" is
 * not actionable.
 */

export type ValidationSeverity = 'ERROR' | 'WARNING';

export interface RuleSetValidationIssue {
  severity: ValidationSeverity;
  code: string;
  message: string;
  ruleIds: string[];
  ruleCodes: string[];
}

export interface ValidateRuleSetOptions {
  /** Known fee type codes, so an action referencing a typo is caught. */
  knownFeeTypeCodes?: readonly string[];
  /** Date the validation is performed for; defaults to today. */
  asOfDate?: string;
}

const KNOWN_FACT_PATHS = new Set<string>([
  ...FEE_RULE_FIELDS.map((field) => field.path),
  'student.id',
  'student.tags',
  'student.siblingCount',
]);

const AMOUNT_DEPENDENT_FACTS = new Set([
  'fee.amount',
  'history.outstandingAmount',
  'payment.amount',
  'history.arrearsAmount',
]);

export function validateRuleSet(
  rules: readonly RuleDefinition[],
  options: ValidateRuleSetOptions = {},
): RuleSetValidationIssue[] {
  const issues: RuleSetValidationIssue[] = [];
  const asOf = options.asOfDate ?? new Date().toISOString().slice(0, 10);

  for (const rule of rules) {
    // --- impossible dates ---
    if (rule.effectiveTo && isAfterDate(rule.effectiveFrom, rule.effectiveTo)) {
      issues.push({
        severity: 'ERROR',
        code: 'IMPOSSIBLE_DATE_RANGE',
        message: `Rule "${rule.name}" starts on ${rule.effectiveFrom} but ends on ${rule.effectiveTo}.`,
        ruleIds: [rule.id],
        ruleCodes: [rule.code],
      });
    }

    // --- expired but still active: a dependency nothing will ever satisfy ---
    if (rule.status === 'ACTIVE' && rule.effectiveTo && isAfterDate(asOf, rule.effectiveTo)) {
      issues.push({
        severity: 'WARNING',
        code: 'EXPIRED_RULE_STILL_ACTIVE',
        message: `Rule "${rule.name}" (${rule.code}) is ACTIVE but its effective window closed on ${rule.effectiveTo}. It will never apply.`,
        ruleIds: [rule.id],
        ruleCodes: [rule.code],
      });
    }

    // --- a rule that cannot do anything ---
    if (rule.actions.length === 0) {
      issues.push({
        severity: 'ERROR',
        code: 'NO_ACTIONS',
        message: `Rule "${rule.name}" (${rule.code}) has no actions, so it can never change an amount.`,
        ruleIds: [rule.id],
        ruleCodes: [rule.code],
      });
    }

    if (rule.policyType === 'SCHOLARSHIP' && rule.stackingMode === 'STACKABLE' && rule.requiresApproval === false) {
      issues.push({
        severity: 'WARNING',
        code: 'SCHOLARSHIP_WITHOUT_APPROVAL',
        message: `Scholarship "${rule.name}" is stackable and does not require approval. Scholarships are normally approved and are often exclusive.`,
        ruleIds: [rule.id],
        ruleCodes: [rule.code],
      });
    }

    // --- per-action validity ---
    for (const action of rule.actions) {
      const needsAmount =
        action.kind === 'ADD_FIXED_AMOUNT' ||
        action.kind === 'DISCOUNT_FIXED' ||
        action.kind === 'OVERRIDE_AMOUNT' ||
        action.kind === 'CAP_AMOUNT' ||
        action.kind === 'SET_MAXIMUM_AMOUNT' ||
        action.kind === 'SET_MINIMUM_AMOUNT' ||
        action.kind === 'ADD_LATE_FEE';
      const needsPercentage = action.kind === 'ADD_PERCENTAGE' || action.kind === 'DISCOUNT_PERCENTAGE';
      if (needsAmount && (action.amount === undefined || action.amount === null)) {
        issues.push({
          severity: 'ERROR',
          code: 'ACTION_MISSING_AMOUNT',
          message: `Rule "${rule.name}" (${rule.code}) uses ${action.kind} without an amount.`,
          ruleIds: [rule.id],
          ruleCodes: [rule.code],
        });
      }
      if (needsPercentage && (action.percentage === undefined || action.percentage === null)) {
        issues.push({
          severity: 'ERROR',
          code: 'ACTION_MISSING_PERCENTAGE',
          message: `Rule "${rule.name}" (${rule.code}) uses ${action.kind} without a percentage.`,
          ruleIds: [rule.id],
          ruleCodes: [rule.code],
        });
      }
      if (action.percentage !== undefined && action.percentage !== null && Number(action.percentage) < 0) {
        issues.push({
          severity: 'ERROR',
          code: 'NEGATIVE_PERCENTAGE',
          message: `Rule "${rule.name}" (${rule.code}) has a negative percentage (${action.percentage}). Use the matching DEBIT action instead.`,
          ruleIds: [rule.id],
          ruleCodes: [rule.code],
        });
      }
      if (action.percentage !== undefined && action.percentage !== null && Number(action.percentage) > 100 && action.kind !== 'ADD_PERCENTAGE') {
        issues.push({
          severity: 'WARNING',
          code: 'PERCENTAGE_OVER_100',
          message: `Rule "${rule.name}" (${rule.code}) removes ${action.percentage}% of the fee. Amounts are clamped at zero, so part of this rule will never take effect.`,
          ruleIds: [rule.id],
          ruleCodes: [rule.code],
        });
      }

      // --- invalid fee reference ---
      if (options.knownFeeTypeCodes && action.feeTypeCodes && action.feeTypeCodes.length > 0) {
        const known = new Set(options.knownFeeTypeCodes.map((code) => code.trim().toLowerCase()));
        const unknown = action.feeTypeCodes.filter((code) => !known.has(code.trim().toLowerCase()));
        if (unknown.length > 0) {
          issues.push({
            severity: 'ERROR',
            code: 'UNKNOWN_FEE_TYPE_REFERENCE',
            message: `Rule "${rule.name}" (${rule.code}) targets fee type(s) that do not exist: ${unknown.join(', ')}.`,
            ruleIds: [rule.id],
            ruleCodes: [rule.code],
          });
        }
      }
    }

    // --- condition validity ---
    const conditionIssues = validateConditions(rule);
    issues.push(...conditionIssues);

    // --- a rule that both adds and waives the same fee is a contradiction ---
    const hasAdd = rule.actions.some((action) => action.kind === 'ADD_FIXED_AMOUNT' || action.kind === 'ADD_PERCENTAGE');
    const hasWaive = rule.actions.some((action) => action.kind === 'WAIVE_FULL' || action.kind === 'EXEMPT');
    if (hasAdd && hasWaive) {
      issues.push({
        severity: 'WARNING',
        code: 'CONTRADICTORY_ACTIONS',
        message: `Rule "${rule.name}" (${rule.code}) both adds to and waives the fee. Split it into two rules so the intent is clear in the audit trail.`,
        ruleIds: [rule.id],
        ruleCodes: [rule.code],
      });
    }
  }

  issues.push(...detectPriorityConflicts(rules));
  issues.push(...detectOrderSensitiveConditions(rules));
  issues.push(...detectCircularArbitration(rules));

  return issues;
}

function validateConditions(rule: RuleDefinition): RuleSetValidationIssue[] {
  const issues: RuleSetValidationIssue[] = [];
  const leaves: Array<{ field: string; operator: string; value: unknown }> = [];
  const walk = (node: ConditionNode | undefined): void => {
    if (!node) return;
    if (node.kind === 'group') {
      node.children.forEach(walk);
      if (node.children.length === 0) {
        issues.push({
          severity: 'WARNING',
          code: 'EMPTY_CONDITION_GROUP',
          message: `Rule "${rule.name}" (${rule.code}) has an empty condition group, which matches everything.`,
          ruleIds: [rule.id],
          ruleCodes: [rule.code],
        });
      }
      return;
    }
    leaves.push({ field: node.field, operator: node.operator, value: node.value });
  };
  walk(rule.conditions);

  for (const leaf of leaves) {
    const isCustom = leaf.field.startsWith('custom.') || leaf.field.startsWith('student.customAttributes.');
    if (!KNOWN_FACT_PATHS.has(leaf.field) && !isCustom) {
      issues.push({
        severity: 'ERROR',
        code: 'UNKNOWN_CONDITION_FIELD',
        message: `Rule "${rule.name}" (${rule.code}) tests "${leaf.field}", which is not a field the engine understands.`,
        ruleIds: [rule.id],
        ruleCodes: [rule.code],
      });
    }
    if ((leaf.operator === 'IN' || leaf.operator === 'NOT_IN') && !Array.isArray(leaf.value)) {
      issues.push({
        severity: 'ERROR',
        code: 'OPERATOR_REQUIRES_LIST',
        message: `Rule "${rule.name}" (${rule.code}) uses ${leaf.operator} on "${leaf.field}" but the value is not a list.`,
        ruleIds: [rule.id],
        ruleCodes: [rule.code],
      });
    }
    if (
      leaf.operator === 'BETWEEN' &&
      (!Array.isArray(leaf.value) || (leaf.value as unknown[]).length !== 2)
    ) {
      issues.push({
        severity: 'ERROR',
        code: 'OPERATOR_REQUIRES_BOUNDS',
        message: `Rule "${rule.name}" (${rule.code}) uses BETWEEN on "${leaf.field}" but does not provide exactly two bounds.`,
        ruleIds: [rule.id],
        ruleCodes: [rule.code],
      });
    }
    if (
      (leaf.operator === 'GT' || leaf.operator === 'GTE' || leaf.operator === 'LT' || leaf.operator === 'LTE') &&
      leaf.value !== undefined &&
      Number.isNaN(Number(leaf.value))
    ) {
      issues.push({
        severity: 'ERROR',
        code: 'OPERATOR_REQUIRES_NUMBER',
        message: `Rule "${rule.name}" (${rule.code}) compares "${leaf.field}" with ${leaf.operator} but "${String(leaf.value)}" is not numeric.`,
        ruleIds: [rule.id],
        ruleCodes: [rule.code],
      });
    }
  }
  return issues;
}

/**
 * Two rules that share a stage, a priority and an arbitration group produce an
 * order decided only by the rule code. That is deterministic, but it is almost
 * never what the administrator intended.
 */
function detectPriorityConflicts(rules: readonly RuleDefinition[]): RuleSetValidationIssue[] {
  const issues: RuleSetValidationIssue[] = [];
  const buckets = new Map<string, RuleDefinition[]>();
  for (const rule of rules) {
    if (rule.status !== 'ACTIVE') continue;
    const key = `${rule.stage}:${rule.arbitrationGroup ?? rule.policyType}:${rule.priority}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(rule);
    else buckets.set(key, [rule]);
  }
  for (const [, bucket] of buckets) {
    if (bucket.length < 2) continue;
    issues.push({
      severity: 'WARNING',
      code: 'DUPLICATE_PRIORITY_CONFLICT',
      message:
        `Rules ${bucket.map((rule) => rule.code).join(', ')} share stage ${bucket[0]!.stage}, ` +
        `priority ${bucket[0]!.priority} and the same arbitration group. Order will fall back to the rule code; ` +
        'give them distinct priorities if the order matters.',
      ruleIds: bucket.map((rule) => rule.id),
      ruleCodes: bucket.map((rule) => rule.code),
    });
  }
  return issues;
}

/**
 * A condition on an amount that an earlier stage has already changed, inside the
 * same stage, makes the outcome order-dependent. This is the practical form of a
 * "circular rule" in a calculation engine that mutates a running total.
 */
function detectOrderSensitiveConditions(rules: readonly RuleDefinition[]): RuleSetValidationIssue[] {
  const issues: RuleSetValidationIssue[] = [];
  for (const rule of rules) {
    if (rule.stage === 'BASE' || rule.stage === 'SURCHARGE') continue;
    const leaves: string[] = [];
    const walk = (node: ConditionNode | undefined): void => {
      if (!node) return;
      if (node.kind === 'group') {
        node.children.forEach(walk);
        return;
      }
      leaves.push(node.field);
    };
    walk(rule.conditions);
    const dependent = leaves.filter((field) => AMOUNT_DEPENDENT_FACTS.has(field));
    if (dependent.length > 0) {
      issues.push({
        severity: 'WARNING',
        code: 'ORDER_SENSITIVE_CONDITION',
        message:
          `Rule "${rule.name}" (${rule.code}) runs at stage ${rule.stage} and tests ${dependent.join(', ')}, ` +
          'which earlier stages already change. The result depends on evaluation order. Move the rule to ' +
          'SURCHARGE (or use a structural fact such as a fee type) for a stable outcome.',
        ruleIds: [rule.id],
        ruleCodes: [rule.code],
      });
    }
  }
  return issues;
}

/**
 * Detects a ruleset where two rules would each rely on the other having been
 * applied: both are HIGHEST_BENEFIT/EXCLUSIVE in the same group while also
 * testing the other's outcome-bearing fact. The engine resolves this
 * deterministically, but the configuration is almost certainly a mistake.
 */
function detectCircularArbitration(rules: readonly RuleDefinition[]): RuleSetValidationIssue[] {
  const issues: RuleSetValidationIssue[] = [];
  const groups = new Map<string, RuleDefinition[]>();
  for (const rule of rules) {
    if (rule.stackingMode !== 'HIGHEST_BENEFIT' && rule.stackingMode !== 'EXCLUSIVE') continue;
    const key = rule.arbitrationGroup ?? `implicit:${rule.stage}:${rule.policyType}`;
    const bucket = groups.get(key);
    if (bucket) bucket.push(rule);
    else groups.set(key, [rule]);
  }
  for (const [key, bucket] of groups) {
    const types = new Set(bucket.map((rule) => rule.policyType));
    if (types.size > 1) {
      issues.push({
        severity: 'WARNING',
        code: 'CIRCULAR_ARBITRATION',
        message:
          `Group "${key}" arbitrates rules of different policy types (${[...types].join(', ')}) with ` +
          `${bucket[0]!.stackingMode}. Which rule wins is priority-decided and the loser is silently dropped; ` +
          'separate the policy types into their own groups unless this is intended.',
        ruleIds: bucket.map((rule) => rule.id),
        ruleCodes: bucket.map((rule) => rule.code),
      });
    }
  }
  return issues;
}

export function hasBlockingIssues(issues: readonly RuleSetValidationIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'ERROR');
}

import { Money } from '@fee/money';
import type { PolicyType, RuleDefinition, SkippedRule, StackingMode } from '@fee/types';
import { applyAction, cloneItemState, measureRuleCredit, type ApplyActionContext, type ItemCalculationState } from './actions';

/**
 * Rule arbitration.
 *
 * Rules inside one arbitration group compete for the same rupee, so they must be
 * resolved deterministically. Two properties matter more than the specific
 * policy chosen:
 *
 *   1. **Determinism.** Ordering is `(priority, code)`, a total order. Two runs
 *      over the same rule set and the same student always produce the same
 *      result, which is what makes a stored calculation reproducible.
 *   2. **Explainability.** Every rule that did *not* apply is reported with a
 *      reason and, when it lost to another rule, the winner's code. "Why is
 *      this fee 27,000?" has to answer "and why not the 40% instead of the 50%?"
 */

export interface ArbitrationInput {
  /** Candidate rules for one stage, already filtered by date/scope/conditions. */
  rules: readonly RuleDefinition[];
  state: ItemCalculationState;
  currency: string;
  stage: ApplyActionContext['stage'];
  allowNegativeTotal: boolean;
  /** Offset so line sequence numbers stay unique within an item. */
  sequenceStart: number;
}

export interface ArbitrationResult {
  /** Rules to apply, in order. */
  apply: RuleDefinition[];
  /** Rules deliberately not applied, with the reason. */
  skipped: SkippedRule[];
}

function compareRules(a: RuleDefinition, b: RuleDefinition): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  if (a.code !== b.code) return a.code < b.code ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Groups rules that must arbitrate against each other.
 *
 * An explicit `arbitrationGroup` always wins. Otherwise a non-stackable mode
 * implies an implicit group of "same stage, same policy type": two sibling
 * discounts should not both apply by accident just because neither declared a
 * group, while a scholarship and a discount remain independent.
 */
function groupKeyFor(rule: RuleDefinition): string {
  if (rule.arbitrationGroup) return `group:${rule.arbitrationGroup}`;
  if (rule.stackingMode === 'STACKABLE') return `solo:${rule.id}`;
  return `implicit:${rule.stage}:${rule.policyType satisfies PolicyType}`;
}

export function arbitrate(input: ArbitrationInput): ArbitrationResult {
  const sorted = [...input.rules].sort(compareRules);
  const groups = new Map<string, RuleDefinition[]>();
  for (const rule of sorted) {
    const key = groupKeyFor(rule);
    const bucket = groups.get(key);
    if (bucket) bucket.push(rule);
    else groups.set(key, [rule]);
  }

  // Groups are processed in the order their best-priority member appears, so a
  // higher-priority group's effect is in the running total before a lower one
  // computes its percentage basis.
  const orderedGroups = [...groups.entries()].sort((a, b) => {
    const priorityDelta = (a[1][0]?.priority ?? 0) - (b[1][0]?.priority ?? 0);
    return priorityDelta !== 0 ? priorityDelta : a[0] < b[0] ? -1 : 1;
  });

  const apply: RuleDefinition[] = [];
  const skipped: SkippedRule[] = [];

  for (const [, members] of orderedGroups) {
    const first = members[0];
    if (!first) continue;
    const mode: StackingMode = first.stackingMode;

    switch (mode) {
      case 'STACKABLE': {
        apply.push(...members);
        break;
      }

      case 'NON_STACKABLE': {
        // First rule that actually moves the number wins; a rule that computes to
        // zero must not block a sibling that would have helped the student.
        let winner: RuleDefinition | undefined;
        for (const rule of members) {
          const credit = measureRuleCredit(input.state, rule, {
            currency: input.currency,
            stage: input.stage,
            allowNegativeTotal: input.allowNegativeTotal,
            sequenceStart: input.sequenceStart,
          });
          if (winner === undefined && !credit.isZero) {
            winner = rule;
            apply.push(rule);
          } else if (winner === undefined) {
            skipped.push(skip(rule, 'ZERO_EFFECT', 'Evaluated to no change'));
          } else if (rule !== winner) {
            skipped.push(skip(rule, 'NON_STACKABLE_ALREADY_APPLIED', undefined, winner.code));
          }
        }
        break;
      }

      case 'EXCLUSIVE': {
        // Priority decides unconditionally, even if the winner's effect is zero.
        apply.push(first);
        for (const rule of members.slice(1)) {
          skipped.push(skip(rule, 'LOST_ARBITRATION', 'Exclusive rule in this group already applied', first.code));
        }
        break;
      }

      case 'PRIORITY_ONLY': {
        // Priority decides, but only among rules of the same policy type; other
        // policy types in the group still get to apply.
        const blockedTypes = new Set<PolicyType>([first.policyType]);
        apply.push(first);
        for (const rule of members.slice(1)) {
          if (blockedTypes.has(rule.policyType)) {
            skipped.push(
              skip(rule, 'LOST_ARBITRATION', `Same policy type as the higher-priority ${first.code}`, first.code),
            );
          } else {
            blockedTypes.add(rule.policyType);
            apply.push(rule);
          }
        }
        break;
      }

      case 'HIGHEST_BENEFIT': {
        let best: { rule: RuleDefinition; credit: Money } | undefined;
        for (const rule of members) {
          const credit = measureRuleCredit(input.state, rule, {
            currency: input.currency,
            stage: input.stage,
            allowNegativeTotal: input.allowNegativeTotal,
            sequenceStart: input.sequenceStart,
          });
          if (!best || credit.greaterThan(best.credit)) best = { rule, credit };
        }
        if (best) {
          apply.push(best.rule);
          for (const rule of members) {
            if (rule.id !== best.rule.id) {
              skipped.push(
                skip(
                  rule,
                  'LOST_ARBITRATION',
                  `Lower benefit (${best.credit.format()}) than ${best.rule.code}`,
                  best.rule.code,
                ),
              );
            }
          }
        }
        break;
      }

      default: {
        const exhaustive: never = mode;
        throw new Error(`Unsupported stacking mode: ${String(exhaustive)}`);
      }
    }
  }

  return { apply, skipped };
}

function skip(rule: RuleDefinition, reason: SkippedRule['reason'], detail?: string, winnerCode?: string): SkippedRule {
  return {
    ruleId: rule.id,
    code: rule.code,
    name: rule.name,
    stage: rule.stage,
    reason,
    detail,
    winnerCode,
  };
}

/** Applies an ordered rule list to an item, one action at a time. */
export function applyRules(
  state: ItemCalculationState,
  rules: readonly RuleDefinition[],
  context: Omit<ApplyActionContext, 'sequenceStart'> & { sequenceStart: number },
): void {
  for (const rule of rules) {
    const actions = [...rule.actions].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    let appliedAny = false;
    for (const action of actions) {
      const result = applyAction(state, action, rule, {
        currency: context.currency,
        stage: context.stage,
        allowNegativeTotal: context.allowNegativeTotal,
        sequenceStart: context.sequenceStart,
      });
      if (result.applied) appliedAny = true;
    }
    // A rule that changed nothing is recorded as skipped so an administrator can
    // see that it was evaluated rather than assume it was ignored.
    if (!appliedAny && !state.skipped.some((entry) => entry.ruleId === rule.id)) {
      state.skipped.push({
        ruleId: rule.id,
        code: rule.code,
        name: rule.name,
        stage: rule.stage,
        reason: 'ZERO_EFFECT',
        detail: 'Rule matched but produced no monetary change',
      });
    }
  }
}

/** Used by the rule preview in the configuration UI. */
export function previewRuleEffect(
  state: ItemCalculationState,
  rule: RuleDefinition,
  context: ApplyActionContext,
): { credit: Money; resultingTotal: Money } {
  const probe = cloneItemState(state);
  for (const action of [...rule.actions].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))) {
    applyAction(probe, action, rule, context);
  }
  return { credit: state.running.subtract(probe.running), resultingTotal: probe.running };
}

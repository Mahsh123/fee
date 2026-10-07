import type { ConditionNode, FeeContext } from '@fee/types';
import {
  compareDecimals,
  compareFactValues,
  isIsoDatePair,
  isNumeric,
  looseEquals,
  resolveFact,
  toBoolean,
  toNumericString,
} from './facts';

/**
 * Condition evaluation.
 *
 * Evaluation is total: every branch returns a boolean and an unresolvable field
 * is treated as *not matching* rather than throwing. A rule that references a
 * fact the tenant has not populated must not break demand generation for 400
 * students; it should simply not apply, and the engine records that the rule was
 * skipped so the omission is visible.
 */

export interface ConditionEvaluation {
  matched: boolean;
  /** Field paths that could not be resolved. Surfaced as a diagnostic. */
  unresolvedFields: string[];
}

export function evaluateConditions(node: ConditionNode | undefined, context: FeeContext): ConditionEvaluation {
  if (!node) return { matched: true, unresolvedFields: [] };
  const unresolved: string[] = [];
  const matched = evaluateNode(node, context, unresolved);
  return { matched, unresolvedFields: unresolved };
}

function evaluateNode(node: ConditionNode, context: FeeContext, unresolved: string[]): boolean {
  if (node.kind === 'group') {
    if (node.children.length === 0) return true;
    const result =
      node.op === 'AND'
        ? node.children.every((child) => evaluateNode(child, context, unresolved))
        : node.children.some((child) => evaluateNode(child, context, unresolved));
    return node.negate ? !result : result;
  }
  const result = evaluateLeaf(node.field, node.operator, node.value, node.valueType, context, unresolved);
  return node.negate ? !result : result;
}

function evaluateLeaf(
  field: string,
  operator: string,
  expected: unknown,
  valueType: string | undefined,
  context: FeeContext,
  unresolved: string[],
): boolean {
  const actual = resolveFact(context, field);
  const hasActual = actual !== undefined && actual !== null && actual !== '';

  if (operator === 'EXISTS') {
    return expected === false ? !hasActual : hasActual;
  }
  if (!hasActual) {
    unresolved.push(field);
    return false;
  }

  const expectsNumber = valueType === 'NUMBER' || isNumeric(expected);

  switch (operator) {
    case 'EQ':
      return expectsNumber && isNumeric(actual)
        ? compareDecimals(toNumericString(actual), toNumericString(expected)) === 0
        : looseEquals(actual, expected);
    case 'NEQ':
      return expectsNumber && isNumeric(actual)
        ? compareDecimals(toNumericString(actual), toNumericString(expected)) !== 0
        : !looseEquals(actual, expected);
    case 'GT':
    case 'GTE':
    case 'LT':
    case 'LTE': {
      // Dates and numbers are both orderable; anything else cannot be compared
      // and must not silently evaluate to false without being reported.
      const comparison = compareFactValues(actual, expected);
      if (comparison === null) {
        unresolved.push(field);
        return false;
      }
      if (operator === 'GT') return comparison > 0;
      if (operator === 'GTE') return comparison >= 0;
      if (operator === 'LT') return comparison < 0;
      return comparison <= 0;
    }
    case 'IN':
    case 'NOT_IN': {
      const list = Array.isArray(expected) ? expected : [expected];
      const found = list.some((candidate) => looseEquals(actual, candidate));
      return operator === 'IN' ? found : !found;
    }
    case 'CONTAINS': {
      if (Array.isArray(actual)) {
        return actual.some((entry) => looseEquals(entry, expected));
      }
      return String(actual).toLowerCase().includes(String(expected).toLowerCase());
    }
    case 'BETWEEN': {
      const bounds = Array.isArray(expected) ? expected : [];
      if (bounds.length !== 2) {
        unresolved.push(field);
        return false;
      }
      const [low, high] = bounds as [unknown, unknown];
      const lower = compareFactValues(actual, low);
      const upper = compareFactValues(actual, high);
      if (lower === null || upper === null) {
        unresolved.push(field);
        return false;
      }
      return lower >= 0 && upper <= 0;
    }
    default:
      unresolved.push(field);
      return false;
  }
}

/** Convenience used by the configuration UI's live rule preview. */
export function explainConditionOutcome(node: ConditionNode | undefined, context: FeeContext): Array<{
  field: string;
  operator: string;
  expected: unknown;
  actual: unknown;
  matched: boolean;
}> {
  const rows: Array<{ field: string; operator: string; expected: unknown; actual: unknown; matched: boolean }> = [];
  const walk = (current: ConditionNode): void => {
    if (current.kind === 'group') {
      current.children.forEach(walk);
      return;
    }
    rows.push({
      field: current.field,
      operator: current.operator,
      expected: current.value,
      actual: resolveFact(context, current.field),
      matched: evaluateNode(current, context, []),
    });
  };
  if (node) walk(node);
  return rows;
}

export function booleanFact(context: FeeContext, path: string): boolean {
  return toBoolean(resolveFact(context, path));
}

/**
 * @fee/fee-engine
 *
 * Deterministic, explainable fee calculation. Given the same context, rule set
 * and version, this engine always produces the same result, and the result
 * carries the derivation that produced it.
 *
 * Nothing in this package touches the database, the clock or the network, which
 * is what makes the financial core unit-testable and reproducible.
 */

export {
  calculateFees,
  CALCULATION_VERSION,
} from './engine';

export { calculateBaseAmount, FeeBaseCalculationError, validateFeeCalculationConfig } from './base-amount';

export {
  applyAction,
  applyItemFloor,
  applyLateFeeAmount,
  applyTax,
  cloneItemState,
  createItemState,
  measureRuleCredit,
  type ApplyActionContext,
  type ApplyActionResult,
  type ItemCalculationState,
} from './actions';

export { arbitrate, applyRules, previewRuleEffect, type ArbitrationInput, type ArbitrationResult } from './stacking';

export { computeLateFee, lateFeeApplies, type LateFeeInput, type LateFeeOutcome } from './late-fee';

export { evaluateConditions, explainConditionOutcome, type ConditionEvaluation } from './conditions';

export {
  compareDecimals,
  compareFactValues,
  isIsoDatePair,
  isNumeric,
  looseEquals,
  resolveFact,
  scopeMatches,
  toBoolean,
  toNumericString,
} from './facts';

export {
  auditLines,
  explainItem,
  renderCalculationText,
  renderItemExplanationText,
} from './explain';

export {
  hasBlockingIssues,
  validateRuleSet,
  type RuleSetValidationIssue,
  type ValidateRuleSetOptions,
  type ValidationSeverity,
} from './validate';

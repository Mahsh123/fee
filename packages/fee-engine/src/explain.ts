import { Money } from '@fee/money';
import { enumLabel, type FeeCalculationItemResult, type FeeCalculationResult, type WhyThisFeeExplanation } from '@fee/types';

/**
 * "Why this fee?" rendering.
 *
 * The calculation result already contains the derivation; this module only
 * presents it. Keeping the explanation derived from the stored result means the
 * answer a parent sees in the portal and the answer an auditor reconstructs from
 * the database are the same answer.
 */

export function explainItem(item: FeeCalculationItemResult, currency = 'INR'): WhyThisFeeExplanation {
  const steps: WhyThisFeeExplanation['steps'] = [];

  steps.push({
    label: `${item.feeTypeName} base fee`,
    amount: item.baseAmount,
    direction: 'DEBIT',
    detail: item.quantity && item.rate ? `${item.quantity} x ${Money.fromString(item.rate, currency).format()}` : enumLabel(item.frequency),
  });

  for (const line of item.lines) {
    if (line.direction === 'CREDIT' && Money.fromString(line.amount, currency).isZero) continue;
    if (line.direction === 'DEBIT' && Money.fromString(line.amount, currency).isZero) continue;
    const prefix = line.direction === 'CREDIT' ? '-' : '+';
    steps.push({
      label: `${prefix} ${line.label}`,
      amount: line.amount,
      direction: line.direction,
      detail: line.reason ?? undefined,
    });
  }

  return {
    feeTypeCode: item.feeTypeCode,
    feeTypeName: item.feeTypeName,
    steps,
    baseAmount: item.baseAmount,
    finalAmount: item.netAmount,
    totalRelief: item.totalRelief,
  };
}

/**
 * A plain-text breakdown, suitable for a receipt footer, an email or a support
 * reply. Deliberately not HTML: the same string is reused across channels.
 */
export function renderItemExplanationText(item: FeeCalculationItemResult, currency = 'INR'): string {
  const explanation = explainItem(item, currency);
  const width = 34;
  const lines: string[] = [];
  const formatRow = (label: string, amount: string): string => {
    const trimmed = label.length > width ? `${label.slice(0, width - 1)}…` : label;
    return `${trimmed.padEnd(width, ' ')}${amount}`;
  };

  for (const step of explanation.steps) {
    const money = Money.fromString(step.amount, currency);
    const rendered = step.direction === 'CREDIT' ? `-${money.format()}` : money.format();
    lines.push(formatRow(step.label, rendered));
  }
  lines.push('-'.repeat(width + 10));
  lines.push(formatRow('Net payable', Money.fromString(explanation.finalAmount, currency).format()));

  if (!Money.fromString(explanation.totalRelief, currency).isZero) {
    lines.push(formatRow('Total relief granted', Money.fromString(explanation.totalRelief, currency).format()));
  }
  return lines.join('\n');
}

/** Whole-result text report: every fee item, then the demand total. */
export function renderCalculationText(result: FeeCalculationResult): string {
  const sections = result.items.map((item) => renderItemExplanationText(item, result.currency));
  const footer = `Total payable: ${Money.fromString(result.totals.netAmount, result.currency).format()}`;
  return [...sections, '', footer].join('\n');
}

/**
 * The per-line audit view: rule identity, approval and effective dates. This is
 * what the admin screen shows behind "show details".
 */
export function auditLines(item: FeeCalculationItemResult): Array<{
  code: string;
  label: string;
  amount: string;
  rule: string | null;
  type: string | null;
  reason: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  effectiveFrom: string | null;
  cappedBy: string | null;
}> {
  return item.lines.map((line) => ({
    code: line.code,
    label: line.label,
    amount: line.amount,
    rule: line.policyName ?? null,
    type: line.policyType ?? null,
    reason: line.reason ?? null,
    approvedBy: line.approvedBy ?? null,
    approvedAt: line.approvedAt ?? null,
    effectiveFrom: line.effectiveFrom ?? null,
    cappedBy: line.cappedBy ?? null,
  }));
}

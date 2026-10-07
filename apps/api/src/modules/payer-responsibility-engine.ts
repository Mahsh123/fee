import { Money, Rate } from '@fee/money';
import type { PayerType } from '@fee/types';

export interface PayerResponsibilityRuleInput {
  id: string;
  payerType: PayerType;
  payerName: string | null;
  payerSponsorId: string | null;
  payerGuardianId: string | null;
  studentId: string | null;
  studentGroupId: string | null;
  academicYearId: string | null;
  feeTypeId: string | null;
  basis: 'FIXED_PER_FEE_ITEM' | 'PERCENTAGE_OF_REMAINDER';
  value: { toString(): string };
  priority: number;
  sponsor?: { id: string; name: string; active: boolean; deletedAt: Date | null } | null;
}

export interface PayerResponsibilityShareInput {
  payerType: PayerType;
  payerName: string;
  payerSponsorId: string | null;
  payerGuardianId: string | null;
  sourceRuleId?: string;
  priority: number;
  amount: string;
}

/** Legacy parent/guardian rules without a stable identity must not be reactivated. */
export function canActivatePayerResponsibilityRule(rule: Pick<PayerResponsibilityRuleInput, 'payerType' | 'payerGuardianId'>): boolean {
  return !((rule.payerType === 'PARENT' || rule.payerType === 'GUARDIAN') && !rule.payerGuardianId);
}

/** Apply ordered, already-effective rules to one calculated demand item. */
export function calculatePayerResponsibilities(input: {
  itemAmount: string;
  currency: string;
  studentId: string;
  studentName: string;
  studentGroupIds: string[];
  studentGuardianIds: string[];
  academicYearId: string | null;
  feeTypeId: string;
  rules: PayerResponsibilityRuleInput[];
}): PayerResponsibilityShareInput[] {
  let remaining = Money.fromString(input.itemAmount, input.currency);
  if (!remaining.isPositive) return [];

  const shares: PayerResponsibilityShareInput[] = [];
  for (const rule of input.rules) {
    if (!remaining.isPositive) break;
    if ((rule.payerType === 'PARENT' || rule.payerType === 'GUARDIAN') && !rule.payerGuardianId) continue;
    if (rule.studentId && rule.studentId !== input.studentId) continue;
    if (rule.studentGroupId && !input.studentGroupIds.includes(rule.studentGroupId)) continue;
    if (rule.payerGuardianId && !input.studentGuardianIds.includes(rule.payerGuardianId)) continue;
    if (rule.academicYearId && rule.academicYearId !== input.academicYearId) continue;
    if (rule.feeTypeId && rule.feeTypeId !== input.feeTypeId) continue;
    if (rule.payerType === 'SPONSOR' && (!rule.sponsor?.active || rule.sponsor.deletedAt)) continue;

    const configured = rule.basis === 'FIXED_PER_FEE_ITEM'
      ? Money.fromString(rule.value.toString(), input.currency)
      : remaining.percent(Rate.fromPercent(rule.value.toString()));
    const amount = configured.min(remaining);
    if (!amount.isPositive) continue;
    shares.push({
      payerType: rule.payerType,
      payerName: rule.payerType === 'SPONSOR' ? rule.sponsor!.name : rule.payerName!,
      payerSponsorId: rule.payerSponsorId,
      payerGuardianId: rule.payerGuardianId,
      sourceRuleId: rule.id,
      priority: rule.priority,
      amount: amount.toString(),
    });
    remaining = remaining.subtract(amount);
  }

  if (remaining.isPositive) {
    shares.push({ payerType: 'STUDENT', payerName: input.studentName, payerSponsorId: null, payerGuardianId: null, priority: 2147483647, amount: remaining.toString() });
  }
  return shares;
}

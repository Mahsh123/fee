import { describe, expect, it } from 'vitest';
import { calculatePayerResponsibilities, canActivatePayerResponsibilityRule, type PayerResponsibilityRuleInput } from './payer-responsibility-engine';

const activeSponsor = { id: 'sponsor-id', name: 'Community Fund', active: true, deletedAt: null };

function rule(overrides: Partial<PayerResponsibilityRuleInput> & Pick<PayerResponsibilityRuleInput, 'id' | 'payerType' | 'basis' | 'value'>): PayerResponsibilityRuleInput {
  return {
    payerName: 'Family Support', payerSponsorId: null, payerGuardianId: null, studentId: null, studentGroupId: null,
    academicYearId: null, feeTypeId: null, priority: 100,
    ...overrides,
  };
}

describe('payer responsibility calculation', () => {
  it('prevents legacy parent and guardian rules without stable identity from being activated', () => {
    expect(canActivatePayerResponsibilityRule({ payerType: 'PARENT', payerGuardianId: null })).toBe(false);
    expect(canActivatePayerResponsibilityRule({ payerType: 'GUARDIAN', payerGuardianId: null })).toBe(false);
    expect(canActivatePayerResponsibilityRule({ payerType: 'PARENT', payerGuardianId: 'guardian-1' })).toBe(true);
    expect(canActivatePayerResponsibilityRule({ payerType: 'SPONSOR', payerGuardianId: null })).toBe(true);
  });

  it('applies ordered percentage-of-remainder rules and assigns the residual to the student', () => {
    const shares = calculatePayerResponsibilities({
      itemAmount: '100.0000', currency: 'INR', studentId: 'student-1', studentName: 'A Student',
      studentGroupIds: ['group-1'], studentGuardianIds: ['guardian-1'], academicYearId: 'year-1', feeTypeId: 'tuition',
      rules: [
        rule({ id: 'sponsor-rule', payerType: 'SPONSOR', payerName: null, payerSponsorId: 'sponsor-id', sponsor: activeSponsor, basis: 'PERCENTAGE_OF_REMAINDER', value: '50', priority: 10 }),
        rule({ id: 'family-rule', payerType: 'PARENT', payerGuardianId: 'guardian-1', basis: 'PERCENTAGE_OF_REMAINDER', value: '20', priority: 20 }),
      ],
    });

    expect(shares).toEqual([
      { payerType: 'SPONSOR', payerName: 'Community Fund', payerSponsorId: 'sponsor-id', payerGuardianId: null, sourceRuleId: 'sponsor-rule', priority: 10, amount: '50.0000' },
      { payerType: 'PARENT', payerName: 'Family Support', payerSponsorId: null, payerGuardianId: 'guardian-1', sourceRuleId: 'family-rule', priority: 20, amount: '10.0000' },
      { payerType: 'STUDENT', payerName: 'A Student', payerSponsorId: null, payerGuardianId: null, priority: 2147483647, amount: '40.0000' },
    ]);
  });

  it('caps fixed shares at the remaining demand and never allocates above the item total', () => {
    const shares = calculatePayerResponsibilities({
      itemAmount: '75.1234', currency: 'INR', studentId: 'student-1', studentName: 'A Student',
      studentGroupIds: [], studentGuardianIds: [], academicYearId: null, feeTypeId: 'tuition',
      rules: [rule({ id: 'fixed', payerType: 'GOVERNMENT', payerName: 'Grant Office', basis: 'FIXED_PER_FEE_ITEM', value: '100.0000' })],
    });

    expect(shares.map((share) => share.amount)).toEqual(['75.1234']);
    expect(shares.reduce((total, share) => total + Number(share.amount), 0)).toBe(75.1234);
  });

  it('skips rules outside their configured scope and inactive sponsors', () => {
    const shares = calculatePayerResponsibilities({
      itemAmount: '80.0000', currency: 'INR', studentId: 'student-1', studentName: 'A Student',
      studentGroupIds: ['group-1'], studentGuardianIds: [], academicYearId: 'year-1', feeTypeId: 'tuition',
      rules: [
        rule({ id: 'other-student', payerType: 'PARENT', basis: 'FIXED_PER_FEE_ITEM', value: '20', studentId: 'student-2' }),
        rule({ id: 'other-group', payerType: 'PARENT', basis: 'FIXED_PER_FEE_ITEM', value: '20', studentGroupId: 'group-2' }),
        rule({ id: 'other-year', payerType: 'PARENT', basis: 'FIXED_PER_FEE_ITEM', value: '20', academicYearId: 'year-2' }),
        rule({ id: 'other-fee', payerType: 'PARENT', basis: 'FIXED_PER_FEE_ITEM', value: '20', feeTypeId: 'transport' }),
        rule({ id: 'inactive-sponsor', payerType: 'SPONSOR', payerName: null, payerSponsorId: 'sponsor-id', sponsor: { ...activeSponsor, active: false }, basis: 'FIXED_PER_FEE_ITEM', value: '20' }),
      ],
    });

    expect(shares).toEqual([{ payerType: 'STUDENT', payerName: 'A Student', payerSponsorId: null, payerGuardianId: null, priority: 2147483647, amount: '80.0000' }]);
  });

  it('assigns a guardian rule only when a tenant-local student link is supplied', () => {
    const guardianRule = rule({ id: 'guardian-rule', payerType: 'GUARDIAN', payerName: 'Display Only Name', payerGuardianId: 'guardian-1', basis: 'FIXED_PER_FEE_ITEM', value: '25' });
    const input = {
      itemAmount: '100.0000', currency: 'INR', studentId: 'student-1', studentName: 'A Student',
      studentGroupIds: ['group-1'], academicYearId: null, feeTypeId: 'tuition', rules: [guardianRule],
    };

    const unlinked = calculatePayerResponsibilities({ ...input, studentGuardianIds: [] });
    const linked = calculatePayerResponsibilities({ ...input, studentGuardianIds: ['guardian-1'] });

    expect(unlinked[0]?.payerType).toBe('STUDENT');
    expect(linked[0]).toMatchObject({ payerType: 'GUARDIAN', payerGuardianId: 'guardian-1', payerName: 'Display Only Name', amount: '25.0000' });
  });
});

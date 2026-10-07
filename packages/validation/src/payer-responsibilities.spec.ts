import { describe, expect, it } from 'vitest';
import { createPayerResponsibilityRuleSchema } from './payer-responsibilities';

const validRule = {
  code: 'COMMUNITY_SHARE',
  name: 'Community fund contribution',
  payerType: 'SPONSOR',
  payerSponsorId: '2d1ef071-e838-46bd-9991-35c024e7e77c',
  basis: 'PERCENTAGE_OF_REMAINDER',
  value: '25',
  effectiveFrom: '2026-04-01',
  effectiveTo: '2027-03-31',
} as const;

describe('payer responsibility rule validation', () => {
  it('accepts a scoped, dated sponsor share rule', () => {
    expect(createPayerResponsibilityRuleSchema.safeParse(validRule).success).toBe(true);
  });

  it('requires a sponsor for sponsor rules and a display name for other payer types', () => {
    expect(createPayerResponsibilityRuleSchema.safeParse({ ...validRule, payerSponsorId: undefined }).success).toBe(false);
    expect(createPayerResponsibilityRuleSchema.safeParse({ ...validRule, payerType: 'PARENT', payerSponsorId: undefined }).success).toBe(false);
  });

  it('requires a linked guardian identity for parent and guardian rules and rejects it for unrelated payer types', () => {
    const guardianId = '3d1ef071-e838-46bd-9991-35c024e7e77c';
    const parentRule = { ...validRule, payerType: 'PARENT', payerSponsorId: undefined, payerGuardianId: guardianId };
    expect(createPayerResponsibilityRuleSchema.safeParse(parentRule).success).toBe(true);
    expect(createPayerResponsibilityRuleSchema.safeParse({ ...parentRule, payerGuardianId: undefined }).success).toBe(false);
    expect(createPayerResponsibilityRuleSchema.safeParse({ ...validRule, payerGuardianId: guardianId }).success).toBe(false);
  });

  it('rejects student-defined responsibility, percentages over 100, reversed dates, and ambiguous student/group scope', () => {
    expect(createPayerResponsibilityRuleSchema.safeParse({ ...validRule, payerType: 'STUDENT', payerSponsorId: undefined, payerName: undefined }).success).toBe(false);
    expect(createPayerResponsibilityRuleSchema.safeParse({ ...validRule, value: '100.0001' }).success).toBe(false);
    expect(createPayerResponsibilityRuleSchema.safeParse({ ...validRule, effectiveFrom: '2027-04-01', effectiveTo: '2027-03-31' }).success).toBe(false);
    expect(createPayerResponsibilityRuleSchema.safeParse({ ...validRule, studentId: '2d1ef071-e838-46bd-9991-35c024e7e77c', studentGroupId: '3d1ef071-e838-46bd-9991-35c024e7e77c' }).success).toBe(false);
  });
});

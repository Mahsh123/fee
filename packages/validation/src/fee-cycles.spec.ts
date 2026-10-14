import { describe, expect, it } from 'vitest';
import { generateFeeAssignmentCycleSchema } from './fees';

const personId = '11111111-1111-4111-8111-111111111111';
const itemId = '22222222-2222-4222-8222-222222222222';
const cycle = {
  frequency: 'MONTHLY',
  periodStart: '2026-10-01',
  periodEnd: '2026-10-31',
  dueDate: '2026-10-15',
  usageInputs: [{ personId, feeStructureItemId: itemId, quantity: '12.5' }],
};

describe('generic recurring billing cycle input', () => {
  it('accepts a dated cycle and person usage quantity', () => {
    expect(generateFeeAssignmentCycleSchema.safeParse(cycle).success).toBe(true);
  });

  it('rejects reversed periods and repeated person/item readings', () => {
    expect(generateFeeAssignmentCycleSchema.safeParse({ ...cycle, periodEnd: '2026-09-30' }).success).toBe(false);
    expect(generateFeeAssignmentCycleSchema.safeParse({ ...cycle, usageInputs: [...cycle.usageInputs, ...cycle.usageInputs] }).success).toBe(false);
  });

  it('accepts one-time charges but rejects custom-date and event fees from cycle generation', () => {
    expect(generateFeeAssignmentCycleSchema.safeParse({ ...cycle, frequency: 'ONE_TIME' }).success).toBe(true);
    for (const frequency of ['CUSTOM_DATE', 'EVENT_BASED']) {
      expect(generateFeeAssignmentCycleSchema.safeParse({ ...cycle, frequency }).success).toBe(false);
    }
  });
});

import { describe, expect, it } from 'vitest';
import type {
  FeeCalculationItemInput,
  FeeCalculationRequest,
  FeeCalculationResult,
  RuleActionDefinition,
  RuleDefinition,
  StudentFacts,
} from '@fee/types';
import { calculateFees } from './engine';
import { renderItemExplanationText, explainItem } from './explain';
import { validateRuleSet, hasBlockingIssues } from './validate';

// ---------------------------------------------------------------------------
// Builders - kept terse so each test reads as the business rule it protects.
// ---------------------------------------------------------------------------

function rule(input: {
  code: string;
  name?: string;
  policyType: RuleDefinition['policyType'];
  stage: RuleDefinition['stage'];
  actions: RuleActionDefinition[];
  stackingMode?: RuleDefinition['stackingMode'];
  priority?: number;
  arbitrationGroup?: string;
  conditions?: RuleDefinition['conditions'];
  scopes?: RuleDefinition['scopes'];
  effectiveFrom?: string;
  effectiveTo?: string | null;
  status?: RuleDefinition['status'];
  requiresApproval?: boolean;
  approvalThreshold?: string;
  instrument?: RuleDefinition['instrument'];
}): RuleDefinition {
  return {
    id: input.code,
    code: input.code,
    name: input.name ?? input.code,
    policyType: input.policyType,
    stage: input.stage,
    priority: input.priority ?? 100,
    stackingMode: input.stackingMode ?? 'STACKABLE',
    actions: input.actions,
    conditions: input.conditions,
    scopes: input.scopes,
    effectiveFrom: input.effectiveFrom ?? '2026-01-01',
    effectiveTo: input.effectiveTo ?? null,
    status: input.status ?? 'ACTIVE',
    requiresApproval: input.requiresApproval,
    approvalThreshold: input.approvalThreshold,
    instrument: input.instrument,
  };
}

function item(overrides: Partial<FeeCalculationItemInput> & { feeTypeCode: string }): FeeCalculationItemInput {
  return {
    key: overrides.feeTypeCode,
    feeTypeName: overrides.feeTypeCode,
    sequence: 1,
    frequency: 'ANNUAL',
    optionality: 'MANDATORY',
    baseAmount: '0',
    ...overrides,
  };
}

const TUITION = (baseAmount = '50000'): FeeCalculationItemInput =>
  item({ feeTypeCode: 'TUITION', feeTypeName: 'Tuition Fee', feeCategoryCode: 'ACADEMIC', baseAmount, dueDate: '2026-04-05' });

const LAB = (baseAmount = '5000'): FeeCalculationItemInput =>
  item({ feeTypeCode: 'LAB', feeTypeName: 'Laboratory Fee', feeCategoryCode: 'LABORATORY', baseAmount, sequence: 2, dueDate: '2026-04-05' });

function request(overrides: Partial<FeeCalculationRequest> & { items: FeeCalculationItemInput[]; rules: RuleDefinition[] }): FeeCalculationRequest {
  const student: StudentFacts = overrides.context?.student ?? {
    id: 'stu-1',
    admissionNumber: 'ADM-001',
    class: 'Grade 10',
    category: 'GENERAL',
    academicScore: '88',
    siblingCount: 0,
    hostelStatus: false,
    transportStatus: false,
  };
  return {
    currency: 'INR',
    roundingMode: 'HALF_UP',
    asOfDate: '2026-04-01',
    ...overrides,
    context: {
      evaluationDate: overrides.asOfDate ?? '2026-04-01',
      student,
      ...overrides.context,
    },
  };
}

/** Every passing test must also prove the engine's own invariant held. */
function expectConsistent(result: FeeCalculationResult): void {
  const inconsistent = result.diagnostics.filter((d) => d.code === 'CALCULATION_INCONSISTENT');
  expect(inconsistent).toEqual([]);
  for (const itemResult of result.items) {
    const gross = Number(itemResult.grossAmount);
    const relief = Number(itemResult.totalRelief);
    const net = Number(itemResult.netAmount);
    expect(Number((gross - relief).toFixed(4))).toBe(Number(net.toFixed(4)));
  }
}

// ---------------------------------------------------------------------------
// Baseline
// ---------------------------------------------------------------------------

describe('fee engine - baseline', () => {
  it('charges the base amount when no rule applies', () => {
    const result = calculateFees(request({ items: [TUITION()], rules: [] }));
    expect(result.status).toBe('OK');
    expect(result.items[0]!.netAmount).toBe('50000.0000');
    expect(result.items[0]!.totalRelief).toBe('0.0000');
    expect(result.totals.netAmount).toBe('50000.0000');
    expectConsistent(result);
  });

  it('sums several fee items into one demand total', () => {
    const result = calculateFees(request({ items: [TUITION(), LAB()], rules: [] }));
    expect(result.totals.baseAmount).toBe('55000.0000');
    expect(result.totals.netAmount).toBe('55000.0000');
    expectConsistent(result);
  });

  it('records every adjustment as a line, so the result explains itself', () => {
    const result = calculateFees(
      request({
        items: [TUITION()],
        rules: [
          rule({
            code: 'MERIT50',
            name: 'Merit Scholarship 50%',
            policyType: 'SCHOLARSHIP',
            stage: 'SCHOLARSHIP',
            actions: [{ kind: 'DISCOUNT_PERCENTAGE', amountBasis: 'BASE_AMOUNT', percentage: '50' }],
          }),
        ],
      }),
    );
    const lines = result.items[0]!.lines;
    expect(lines).toHaveLength(1);
    expect(lines[0]!.code).toBe('SCHOLARSHIP:MERIT50');
    expect(lines[0]!.amount).toBe('25000.0000');
    expect(lines[0]!.direction).toBe('CREDIT');
    expect(lines[0]!.runningTotalAfter).toBe('25000.0000');
  });
});

// ---------------------------------------------------------------------------
// Scholarships, discounts, concessions, waivers
// ---------------------------------------------------------------------------

describe('fee engine - scholarships', () => {
  it('applies a 100% scholarship, leaving nothing payable', () => {
    const result = calculateFees(
      request({
        items: [TUITION()],
        rules: [
          rule({
            code: 'FULL',
            policyType: 'SCHOLARSHIP',
            stage: 'SCHOLARSHIP',
            actions: [{ kind: 'WAIVE_FULL' }],
          }),
        ],
      }),
    );
    expect(result.items[0]!.netAmount).toBe('0.0000');
    // WAIVE_FULL is recorded as scholarship relief because of the policy type.
    expect(result.items[0]!.scholarshipAmount).toBe('50000.0000');
    expectConsistent(result);
  });

  it('applies a 50% scholarship to the base amount', () => {
    const result = calculateFees(
      request({
        items: [TUITION()],
        rules: [
          rule({
            code: 'MERIT50',
            policyType: 'SCHOLARSHIP',
            stage: 'SCHOLARSHIP',
            actions: [{ kind: 'DISCOUNT_PERCENTAGE', amountBasis: 'BASE_AMOUNT', percentage: '50' }],
          }),
        ],
      }),
    );
    expect(result.items[0]!.netAmount).toBe('25000.0000');
    expect(result.items[0]!.scholarshipAmount).toBe('25000.0000');
  });

  it('applies a fixed-amount scholarship capped at its maximum', () => {
    const result = calculateFees(
      request({
        items: [TUITION()],
        rules: [
          rule({
            code: 'FIXED',
            policyType: 'SCHOLARSHIP',
            stage: 'SCHOLARSHIP',
            actions: [{ kind: 'DISCOUNT_FIXED', amount: '20000', capAmount: '15000' }],
          }),
        ],
      }),
    );
    expect(result.items[0]!.scholarshipAmount).toBe('15000.0000');
    expect(result.items[0]!.netAmount).toBe('35000.0000');
    expect(result.items[0]!.cappedAmount).toBe('5000.0000');
    expect(result.diagnostics.some((d) => d.code === 'ADJUSTMENT_CAPPED')).toBe(true);
    expectConsistent(result);
  });

  it('limits a fee-specific scholarship to the fee type it names', () => {
    const result = calculateFees(
      request({
        items: [TUITION(), LAB()],
        rules: [
          rule({
            code: 'TUITION_ONLY',
            policyType: 'SCHOLARSHIP',
            stage: 'SCHOLARSHIP',
            actions: [{ kind: 'DISCOUNT_PERCENTAGE', amountBasis: 'BASE_AMOUNT', percentage: '50', feeTypeCodes: ['TUITION'] }],
          }),
        ],
      }),
    );
    expect(result.items[0]!.netAmount).toBe('25000.0000');
    expect(result.items[1]!.netAmount).toBe('5000.0000');
    expect(result.totals.netAmount).toBe('30000.0000');
  });

  it('carries approval provenance onto the adjustment line', () => {
    const result = calculateFees(
      request({
        items: [TUITION()],
        rules: [
          rule({
            code: 'TRUST',
            policyType: 'SCHOLARSHIP',
            stage: 'SCHOLARSHIP',
            actions: [{ kind: 'DISCOUNT_FIXED', amount: '10000' }],
            instrument: {
              type: 'SCHOLARSHIP',
              id: 'sch-1',
              name: 'Trust Scholarship',
              reason: 'Approved by the trust board',
              approvedBy: 'user-9',
              approvedAt: '2026-03-01',
            },
          }),
        ],
      }),
    );
    const line = result.items[0]!.lines[0]!;
    expect(line.instrumentType).toBe('SCHOLARSHIP');
    expect(line.instrumentId).toBe('sch-1');
    expect(line.reason).toBe('Approved by the trust board');
    expect(line.approvedBy).toBe('user-9');
    expect(line.approvedAt).toBe('2026-03-01');
  });
});

describe('fee engine - discounts and concessions', () => {
  it('applies a sibling discount to the named fee types only', () => {
    const result = calculateFees(
      request({
        items: [TUITION(), LAB()],
        rules: [
          rule({
            code: 'SIBLING10',
            name: 'Sibling concession 10%',
            policyType: 'DISCOUNT',
            stage: 'DISCOUNT',
            actions: [{ kind: 'DISCOUNT_PERCENTAGE', amountBasis: 'BASE_AMOUNT', percentage: '10', feeTypeCodes: ['TUITION'] }],
            conditions: { kind: 'condition', field: 'student.siblingCount', operator: 'GTE', value: 1, valueType: 'NUMBER' },
          }),
        ],
        context: { evaluationDate: '2026-04-01', student: { id: 'stu-1', siblingCount: 2 } },
      }),
    );
    expect(result.items[0]!.netAmount).toBe('45000.0000');
    expect(result.items[1]!.netAmount).toBe('5000.0000');
    expect(result.totals.discountAmount).toBe('5000.0000');
  });

  it('stacks a scholarship and a discount in stage order', () => {
    const result = calculateFees(
      request({
        items: [TUITION()],
        rules: [
          rule({
            code: 'MERIT50',
            policyType: 'SCHOLARSHIP',
            stage: 'SCHOLARSHIP',
            priority: 10,
            actions: [{ kind: 'DISCOUNT_PERCENTAGE', amountBasis: 'BASE_AMOUNT', percentage: '50' }],
          }),
          rule({
            code: 'SIBLING5',
            policyType: 'DISCOUNT',
            stage: 'DISCOUNT',
            priority: 20,
            actions: [{ kind: 'DISCOUNT_PERCENTAGE', amountBasis: 'BASE_AMOUNT', percentage: '5' }],
          }),
        ],
      }),
    );
    // 50,000 - 25,000 - 2,500; the discount is computed on the base it declares.
    expect(result.items[0]!.scholarshipAmount).toBe('25000.0000');
    expect(result.items[0]!.discountAmount).toBe('2500.0000');
    expect(result.items[0]!.netAmount).toBe('22500.0000');
    expectConsistent(result);
  });

  it('computes a percentage on the running total when the rule asks for it', () => {
    const result = calculateFees(
      request({
        items: [TUITION()],
        rules: [
          rule({
            code: 'MERIT50',
            policyType: 'SCHOLARSHIP',
            stage: 'SCHOLARSHIP',
            priority: 10,
            actions: [{ kind: 'DISCOUNT_PERCENTAGE', amountBasis: 'BASE_AMOUNT', percentage: '50' }],
          }),
          rule({
            code: 'SIBLING5',
            policyType: 'DISCOUNT',
            stage: 'DISCOUNT',
            priority: 20,
            actions: [{ kind: 'DISCOUNT_PERCENTAGE', amountBasis: 'RUNNING_TOTAL', percentage: '5' }],
          }),
        ],
      }),
    );
    // 25,000 remaining, then 5% of that remaining amount.
    expect(result.items[0]!.discountAmount).toBe('1250.0000');
    expect(result.items[0]!.netAmount).toBe('23750.0000');
  });

  it('records a concession separately from a discount so reports stay truthful', () => {
    const result = calculateFees(
      request({
        items: [TUITION()],
        rules: [
          rule({
            code: 'HARDSHIP',
            policyType: 'CONCESSION',
            stage: 'CONCESSION',
            actions: [{ kind: 'DISCOUNT_PERCENTAGE', amountBasis: 'BASE_AMOUNT', percentage: '20' }],
          }),
        ],
      }),
    );
    expect(result.totals.concessionAmount).toBe('10000.0000');
    expect(result.totals.discountAmount).toBe('0.0000');
  });

  it('applies a partial waiver of a fixed amount', () => {
    const result = calculateFees(
      request({
        items: [TUITION()],
        rules: [
          rule({
            code: 'MGMT',
            name: 'Management waiver',
            policyType: 'WAIVER',
            stage: 'WAIVER',
            actions: [{ kind: 'WAIVE_PARTIAL', amount: '5000' }],
          }),
        ],
      }),
    );
    expect(result.items[0]!.waiverAmount).toBe('5000.0000');
    expect(result.items[0]!.netAmount).toBe('45000.0000');
  });

  it('reports an exemption differently from a waiver', () => {
    const waived = calculateFees(
      request({
        items: [TUITION()],
        rules: [rule({ code: 'W', policyType: 'WAIVER', stage: 'WAIVER', actions: [{ kind: 'EXEMPT' }] })],
      }),
    );
    expect(waived.totals.waiverAmount).toBe('50000.0000');
    expect(waived.totals.discountAmount).toBe('0.0000');
  });
});

// ---------------------------------------------------------------------------
// Surcharges and taxes
// ---------------------------------------------------------------------------

describe('fee engine - surcharges and tax', () => {
  it('adds a mandatory surcharge before relief is computed', () => {
    const result = calculateFees(
      request({
        items: [TUITION()],
        rules: [
          rule({
            code: 'INTL',
            name: 'International student fee',
            policyType: 'SURCHARGE',
            stage: 'SURCHARGE',
            priority: 10,
            actions: [{ kind: 'ADD_FIXED_AMOUNT', amount: '10000' }],
          }),
          rule({
            code: 'MERIT10',
            policyType: 'SCHOLARSHIP',
            stage: 'SCHOLARSHIP',
            priority: 20,
            actions: [{ kind: 'DISCOUNT_PERCENTAGE', amountBasis: 'RUNNING_TOTAL', percentage: '10' }],
          }),
        ],
      }),
    );
    // 50,000 + 10,000 = 60,000, then 10% of that = 6,000 relief.
    expect(result.items[0]!.surchargeAmount).toBe('10000.0000');
    expect(result.items[0]!.scholarshipAmount).toBe('6000.0000');
    expect(result.items[0]!.netAmount).toBe('54000.0000');
    expectConsistent(result);
  });

  it('taxes the amount payable after relief, not the gross fee', () => {
    const result = calculateFees(
      request({
        items: [item({ feeTypeCode: 'TUITION', feeTypeName: 'Tuition', baseAmount: '50000', taxable: true, taxPercent: '18' })],
        rules: [
          rule({
            code: 'MERIT50',
            policyType: 'SCHOLARSHIP',
            stage: 'SCHOLARSHIP',
            actions: [{ kind: 'DISCOUNT_PERCENTAGE', amountBasis: 'BASE_AMOUNT', percentage: '50' }],
          }),
        ],
      }),
    );
    // 50,000 - 25,000 = 25,000 taxable, tax = 4,500.
    expect(result.items[0]!.taxAmount).toBe('4500.0000');
    expect(result.items[0]!.netAmount).toBe('29500.0000');
    expect(result.items[0]!.lines.some((line) => line.code === 'TAX')).toBe(true);
    expectConsistent(result);
  });
});

// ---------------------------------------------------------------------------
// Stacking arbitration
// ---------------------------------------------------------------------------

describe('fee engine - stacking and arbitration', () => {
  it('applies only the first non-stackable rule in a group', () => {
    const result = calculateFees(
      request({
        items: [TUITION()],
        rules: [
          rule({
            code: 'BIG20',
            policyType: 'DISCOUNT',
            stage: 'DISCOUNT',
            priority: 10,
            stackingMode: 'NON_STACKABLE',
            actions: [{ kind: 'DISCOUNT_PERCENTAGE', amountBasis: 'BASE_AMOUNT', percentage: '20' }],
          }),
          rule({
            code: 'SMALL10',
            policyType: 'DISCOUNT',
            stage: 'DISCOUNT',
            priority: 20,
            stackingMode: 'NON_STACKABLE',
            actions: [{ kind: 'DISCOUNT_PERCENTAGE', amountBasis: 'BASE_AMOUNT', percentage: '10' }],
          }),
        ],
      }),
    );
    expect(result.items[0]!.discountAmount).toBe('10000.0000');
    expect(result.items[0]!.netAmount).toBe('40000.0000');
    const skipped = result.items[0]!.skippedRules.find((entry) => entry.code === 'SMALL10');
    expect(skipped?.reason).toBe('NON_STACKABLE_ALREADY_APPLIED');
    expect(skipped?.winnerCode).toBe('BIG20');
  });

  it('lets a zero-effect non-stackable rule step aside for a sibling that helps', () => {
    const result = calculateFees(
      request({
        items: [TUITION()],
        rules: [
          rule({
            code: 'NOOP',
            policyType: 'DISCOUNT',
            stage: 'DISCOUNT',
            priority: 10,
            stackingMode: 'NON_STACKABLE',
            // Percentage of zero, so this rule changes nothing.
            actions: [{ kind: 'DISCOUNT_PERCENTAGE', amountBasis: 'BASE_AMOUNT', percentage: '0' }],
          }),
          rule({
            code: 'REAL10',
            policyType: 'DISCOUNT',
            stage: 'DISCOUNT',
            priority: 20,
            stackingMode: 'NON_STACKABLE',
            actions: [{ kind: 'DISCOUNT_PERCENTAGE', amountBasis: 'BASE_AMOUNT', percentage: '10' }],
          }),
        ],
      }),
    );
    expect(result.items[0]!.discountAmount).toBe('5000.0000');
    expect(result.items[0]!.skippedRules.some((entry) => entry.code === 'NOOP' && entry.reason === 'ZERO_EFFECT')).toBe(true);
  });

  it('honours priority when two rules are exclusive', () => {
    const result = calculateFees(
      request({
        items: [TUITION()],
        rules: [
          rule({
            code: 'LOW20',
            policyType: 'DISCOUNT',
            stage: 'DISCOUNT',
            priority: 10,
            stackingMode: 'EXCLUSIVE',
            arbitrationGroup: 'sibling-pool',
            actions: [{ kind: 'DISCOUNT_PERCENTAGE', amountBasis: 'BASE_AMOUNT', percentage: '20' }],
          }),
          rule({
            code: 'HIGH30',
            policyType: 'DISCOUNT',
            stage: 'DISCOUNT',
            priority: 20,
            stackingMode: 'EXCLUSIVE',
            arbitrationGroup: 'sibling-pool',
            actions: [{ kind: 'DISCOUNT_PERCENTAGE', amountBasis: 'BASE_AMOUNT', percentage: '30' }],
          }),
        ],
      }),
    );
    // Priority decides, not size: the lower priority number wins even though it
    // is worth less to the family.
    expect(result.items[0]!.discountAmount).toBe('10000.0000');
    const loser = result.items[0]!.skippedRules.find((entry) => entry.code === 'HIGH30');
    expect(loser?.reason).toBe('LOST_ARBITRATION');
    expect(loser?.winnerCode).toBe('LOW20');
  });

  it('picks the most valuable rule under HIGHEST_BENEFIT', () => {
    const result = calculateFees(
      request({
        items: [TUITION()],
        rules: [
          rule({
            code: 'PCT10',
            policyType: 'DISCOUNT',
            stage: 'DISCOUNT',
            priority: 10,
            stackingMode: 'HIGHEST_BENEFIT',
            arbitrationGroup: 'best-of',
            actions: [{ kind: 'DISCOUNT_PERCENTAGE', amountBasis: 'BASE_AMOUNT', percentage: '10' }],
          }),
          rule({
            code: 'FIXED20000',
            policyType: 'DISCOUNT',
            stage: 'DISCOUNT',
            priority: 20,
            stackingMode: 'HIGHEST_BENEFIT',
            arbitrationGroup: 'best-of',
            actions: [{ kind: 'DISCOUNT_FIXED', amount: '20000' }],
          }),
        ],
      }),
    );
    expect(result.items[0]!.discountAmount).toBe('20000.0000');
    const skipped = result.items[0]!.skippedRules.find((entry) => entry.code === 'PCT10');
    expect(skipped?.reason).toBe('LOST_ARBITRATION');
    expect(skipped?.winnerCode).toBe('FIXED20000');
  });

  it('blocks only the same policy type under PRIORITY_ONLY', () => {
    const result = calculateFees(
      request({
        items: [TUITION()],
        rules: [
          rule({
            code: 'DISC10',
            policyType: 'DISCOUNT',
            stage: 'DISCOUNT',
            priority: 10,
            stackingMode: 'PRIORITY_ONLY',
            arbitrationGroup: 'shared',
            actions: [{ kind: 'DISCOUNT_PERCENTAGE', amountBasis: 'BASE_AMOUNT', percentage: '10' }],
          }),
          rule({
            code: 'DISC20',
            policyType: 'DISCOUNT',
            stage: 'DISCOUNT',
            priority: 20,
            stackingMode: 'PRIORITY_ONLY',
            arbitrationGroup: 'shared',
            actions: [{ kind: 'DISCOUNT_PERCENTAGE', amountBasis: 'BASE_AMOUNT', percentage: '20' }],
          }),
        ],
      }),
    );
    expect(result.items[0]!.discountAmount).toBe('5000.0000');
    expect(result.items[0]!.skippedRules.find((entry) => entry.code === 'DISC20')?.reason).toBe('LOST_ARBITRATION');
  });
});

// ---------------------------------------------------------------------------
// Overrides, caps and floors
// ---------------------------------------------------------------------------

describe('fee engine - overrides, caps and floors', () => {
  it('overrides the price for one student and preserves the original', () => {
    const result = calculateFees(
      request({
        items: [TUITION()],
        rules: [
          rule({
            code: 'STU-OVERRIDE',
            name: 'Negotiated tuition',
            policyType: 'OVERRIDE',
            stage: 'OVERRIDE',
            actions: [{ kind: 'OVERRIDE_AMOUNT', amount: '27500' }],
            instrument: { type: 'OVERRIDE', id: 'ovr-1', name: 'Negotiated tuition', reason: 'Management quota' },
          }),
        ],
      }),
    );
    expect(result.items[0]!.baseAmount).toBe('50000.0000');
    expect(result.items[0]!.overrideAmount).toBe('22500.0000');
    expect(result.items[0]!.netAmount).toBe('27500.0000');
    expectConsistent(result);
  });

  it('handles an override that raises the price', () => {
    const result = calculateFees(
      request({
        items: [TUITION()],
        rules: [
          rule({
            code: 'PREMIUM',
            policyType: 'OVERRIDE',
            stage: 'OVERRIDE',
            actions: [{ kind: 'OVERRIDE_AMOUNT', amount: '60000' }],
          }),
        ],
      }),
    );
    expect(result.items[0]!.overrideAmount).toBe('-10000.0000');
    expect(result.items[0]!.netAmount).toBe('60000.0000');
    expectConsistent(result);
  });

  it('caps the payable amount', () => {
    const result = calculateFees(
      request({
        items: [TUITION()],
        rules: [
          rule({
            code: 'CAP30K',
            policyType: 'DISCOUNT',
            stage: 'LIMIT',
            actions: [{ kind: 'CAP_AMOUNT', amount: '30000' }],
          }),
        ],
      }),
    );
    expect(result.items[0]!.netAmount).toBe('30000.0000');
  });

  it('applies a minimum payable floor after relief', () => {
    const result = calculateFees(
      request({
        items: [TUITION()],
        rules: [
          rule({
            code: 'MERIT90',
            policyType: 'SCHOLARSHIP',
            stage: 'SCHOLARSHIP',
            priority: 10,
            actions: [{ kind: 'DISCOUNT_PERCENTAGE', amountBasis: 'BASE_AMOUNT', percentage: '90' }],
          }),
          rule({
            code: 'FLOOR15K',
            policyType: 'DISCOUNT',
            stage: 'LIMIT',
            priority: 20,
            actions: [{ kind: 'SET_MINIMUM_AMOUNT', amount: '15000' }],
          }),
        ],
      }),
    );
    expect(result.items[0]!.netAmount).toBe('15000.0000');
    expectConsistent(result);
  });

  it('never lets relief push a fee below zero unless the tenant allows it', () => {
    const result = calculateFees(
      request({
        items: [TUITION()],
        rules: [
          rule({
            code: 'TOO_MUCH',
            policyType: 'DISCOUNT',
            stage: 'DISCOUNT',
            priority: 10,
            actions: [{ kind: 'DISCOUNT_FIXED', amount: '80000' }],
          }),
          rule({
            code: 'ALSO',
            policyType: 'DISCOUNT',
            stage: 'DISCOUNT',
            priority: 20,
            actions: [{ kind: 'DISCOUNT_FIXED', amount: '10000' }],
          }),
        ],
      }),
    );
    expect(result.items[0]!.netAmount).toBe('0.0000');
    expect(result.items[0]!.cappedAmount).toBe('40000.0000');
    expect(result.status).not.toBe('FAILED');
  });

  it('surfaces a mandatory fee with a zero base amount as needing attention', () => {
    const result = calculateFees(request({ items: [TUITION('0')], rules: [] }));
    expect(result.items[0]!.needsAttention).toBe(true);
    expect(result.diagnostics.some((d) => d.code === 'ZERO_BASE_AMOUNT')).toBe(true);
    expect(result.status).toBe('NEEDS_ATTENTION');
  });
});

// ---------------------------------------------------------------------------
// Conditions and scope
// ---------------------------------------------------------------------------

describe('fee engine - conditions', () => {
  it('evaluates a numeric threshold on the student score', () => {
    const merit = rule({
      code: 'MERIT',
      policyType: 'SCHOLARSHIP',
      stage: 'SCHOLARSHIP',
      actions: [{ kind: 'DISCOUNT_PERCENTAGE', amountBasis: 'BASE_AMOUNT', percentage: '25' }],
      conditions: { kind: 'condition', field: 'student.academicScore', operator: 'GTE', value: 90, valueType: 'NUMBER' },
    });

    const highScorer = calculateFees(
      request({ items: [TUITION()], rules: [merit], context: { evaluationDate: '2026-04-01', student: { academicScore: '92.5' } } }),
    );
    expect(highScorer.items[0]!.netAmount).toBe('37500.0000');

    const lowScorer = calculateFees(
      request({ items: [TUITION()], rules: [merit], context: { evaluationDate: '2026-04-01', student: { academicScore: '85' } } }),
    );
    expect(lowScorer.items[0]!.netAmount).toBe('50000.0000');
    expect(lowScorer.diagnostics.some((d) => d.code === 'RULE_CONDITIONS_UNMET')).toBe(true);
  });

  it('supports an early-payment discount keyed on the payment date', () => {
    const earlyPayment = rule({
      code: 'EARLY5',
      name: '5% early payment discount',
      policyType: 'EARLY_PAYMENT_DISCOUNT',
      stage: 'DISCOUNT',
      actions: [{ kind: 'DISCOUNT_PERCENTAGE', amountBasis: 'BASE_AMOUNT', percentage: '5' }],
      conditions: { kind: 'condition', field: 'payment.date', operator: 'LT', value: '2026-06-10', valueType: 'DATE' },
    });

    const early = calculateFees(
      request({
        items: [TUITION()],
        rules: [earlyPayment],
        context: { evaluationDate: '2026-06-01', student: { id: 'stu-1' }, payment: { date: '2026-06-01' } },
      }),
    );
    expect(early.items[0]!.discountAmount).toBe('2500.0000');

    const late = calculateFees(
      request({
        items: [TUITION()],
        rules: [earlyPayment],
        context: { evaluationDate: '2026-06-20', student: { id: 'stu-1' }, payment: { date: '2026-06-20' } },
      }),
    );
    expect(late.items[0]!.discountAmount).toBe('0.0000');
  });

  it('evaluates an AND group and an IN list', () => {
    const combined = rule({
      code: 'CSE_MERIT',
      policyType: 'SCHOLARSHIP',
      stage: 'SCHOLARSHIP',
      actions: [{ kind: 'DISCOUNT_FIXED', amount: '10000' }],
      conditions: {
        kind: 'group',
        op: 'AND',
        children: [
          { kind: 'condition', field: 'student.course', operator: 'EQ', value: 'B.Tech CSE' },
          { kind: 'condition', field: 'student.academicScore', operator: 'GTE', value: '90', valueType: 'NUMBER' },
          { kind: 'condition', field: 'student.category', operator: 'IN', value: ['GENERAL', 'EWS'] },
        ],
      },
    });

    const matched = calculateFees(
      request({
        items: [TUITION()],
        rules: [combined],
        context: {
          evaluationDate: '2026-04-01',
          student: { course: 'b.tech cse', academicScore: '94', category: 'EWS' },
        },
      }),
    );
    expect(matched.items[0]!.netAmount).toBe('40000.0000');

    const unmatched = calculateFees(
      request({
        items: [TUITION()],
        rules: [combined],
        context: {
          evaluationDate: '2026-04-01',
          student: { course: 'B.Tech CSE', academicScore: '94', category: 'SC' },
        },
      }),
    );
    expect(unmatched.items[0]!.netAmount).toBe('50000.0000');
  });

  it('matches an OR group where only one branch holds', () => {
    const either = rule({
      code: 'EITHER',
      policyType: 'DISCOUNT',
      stage: 'DISCOUNT',
      actions: [{ kind: 'DISCOUNT_FIXED', amount: '1000' }],
      conditions: {
        kind: 'group',
        op: 'OR',
        children: [
          { kind: 'condition', field: 'student.hostelStatus', operator: 'EQ', value: true, valueType: 'BOOLEAN' },
          { kind: 'condition', field: 'student.transportStatus', operator: 'EQ', value: true, valueType: 'BOOLEAN' },
        ],
      },
    });
    const result = calculateFees(
      request({
        items: [TUITION()],
        rules: [either],
        context: { evaluationDate: '2026-04-01', student: { hostelStatus: false, transportStatus: true } },
      }),
    );
    expect(result.items[0]!.discountAmount).toBe('1000.0000');
  });

  it('reports a rule that references a fact the student does not have', () => {
    const result = calculateFees(
      request({
        items: [TUITION()],
        rules: [
          rule({
            code: 'NEEDS_ROUTE',
            policyType: 'DISCOUNT',
            stage: 'DISCOUNT',
            actions: [{ kind: 'DISCOUNT_FIXED', amount: '500' }],
            conditions: { kind: 'condition', field: 'student.transportRoute', operator: 'EQ', value: 'ROUTE-A' },
          }),
        ],
        context: { evaluationDate: '2026-04-01', student: { id: 'stu-1' } },
      }),
    );
    expect(result.items[0]!.netAmount).toBe('50000.0000');
    expect(result.diagnostics.some((d) => d.code === 'CONDITION_FIELD_UNRESOLVED')).toBe(true);
  });

  it('matches a rule scoped to a parent academic unit through the unit path', () => {
    const result = calculateFees(
      request({
        items: [TUITION()],
        rules: [
          rule({
            code: 'PROGRAM_WIDE',
            policyType: 'DISCOUNT',
            stage: 'DISCOUNT',
            actions: [{ kind: 'DISCOUNT_FIXED', amount: '2000' }],
            scopes: [{ targetType: 'PROGRAM', targetId: 'unit-program-1' }],
          }),
        ],
        context: { evaluationDate: '2026-04-01', student: { id: 'stu-1' }, scopeUnits: ['unit-class-10a', 'unit-program-1'] },
      }),
    );
    expect(result.items[0]!.discountAmount).toBe('2000.0000');
  });

  it('skips a rule whose scope does not contain the student', () => {
    const result = calculateFees(
      request({
        items: [TUITION()],
        rules: [
          rule({
            code: 'GRADE_9_ONLY',
            policyType: 'DISCOUNT',
            stage: 'DISCOUNT',
            actions: [{ kind: 'DISCOUNT_FIXED', amount: '2000' }],
            scopes: [{ targetType: 'CLASS', targetId: 'unit-class-9a' }],
          }),
        ],
        context: { evaluationDate: '2026-04-01', student: { id: 'stu-1' }, scopeUnits: ['unit-class-10a'] },
      }),
    );
    expect(result.items[0]!.discountAmount).toBe('0.0000');
    expect(result.items[0]!.skippedRules.some((entry) => entry.reason === 'SCOPE_MISMATCH')).toBe(true);
  });

  it('ignores rules outside their effective window without failing the run', () => {
    const result = calculateFees(
      request({
        items: [TUITION()],
        rules: [
          rule({
            code: 'LAST_YEAR',
            policyType: 'DISCOUNT',
            stage: 'DISCOUNT',
            actions: [{ kind: 'DISCOUNT_FIXED', amount: '1000' }],
            effectiveFrom: '2025-04-01',
            effectiveTo: '2026-03-31',
          }),
        ],
      }),
    );
    expect(result.items[0]!.discountAmount).toBe('0.0000');
    expect(result.diagnostics.some((d) => d.code === 'RULES_OUT_OF_WINDOW')).toBe(true);
  });

  it('ignores non-active rules and says so', () => {
    const result = calculateFees(
      request({
        items: [TUITION()],
        rules: [
          rule({
            code: 'DRAFTED',
            policyType: 'DISCOUNT',
            stage: 'DISCOUNT',
            status: 'DRAFT',
            actions: [{ kind: 'DISCOUNT_FIXED', amount: '1000' }],
          }),
        ],
      }),
    );
    expect(result.items[0]!.discountAmount).toBe('0.0000');
    expect(result.diagnostics.some((d) => d.code === 'RULES_NOT_ACTIVE')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Late fees
// ---------------------------------------------------------------------------

describe('fee engine - late fees', () => {
  it('charges a per-day late fee after the grace period', () => {
    const result = calculateFees(
      request({
        items: [TUITION()],
        rules: [],
        asOfDate: '2026-04-20',
        lateFee: { mode: 'PER_DAY', graceDays: 0, perDayAmount: '100', maxAmount: '2000' },
      }),
    );
    // Due 2026-04-05, evaluated 2026-04-20 => 15 days late.
    expect(result.items[0]!.lateFeeAmount).toBe('1500.0000');
    expect(result.items[0]!.netAmount).toBe('51500.0000');
    expectConsistent(result);
  });

  it('respects the grace period', () => {
    const result = calculateFees(
      request({
        items: [TUITION()],
        rules: [],
        asOfDate: '2026-04-20',
        lateFee: { mode: 'PER_DAY', graceDays: 10, perDayAmount: '100' },
      }),
    );
    // 15 days late minus 10 grace days = 5 chargeable days.
    expect(result.items[0]!.lateFeeAmount).toBe('500.0000');
  });

  it('caps the late fee at the configured maximum', () => {
    const result = calculateFees(
      request({
        items: [TUITION()],
        rules: [],
        asOfDate: '2026-06-30',
        lateFee: { mode: 'PER_DAY', graceDays: 0, perDayAmount: '100', maxAmount: '2000' },
      }),
    );
    expect(result.items[0]!.lateFeeAmount).toBe('2000.0000');
  });

  it('charges no late fee before the due date', () => {
    const result = calculateFees(
      request({
        items: [TUITION()],
        rules: [],
        asOfDate: '2026-04-01',
        lateFee: { mode: 'PER_DAY', graceDays: 0, perDayAmount: '100' },
      }),
    );
    expect(result.items[0]!.lateFeeAmount).toBe('0.0000');
  });

  it('computes a percentage late fee on the outstanding balance only', () => {
    const result = calculateFees(
      request({
        items: [item({ feeTypeCode: 'TUITION', feeTypeName: 'Tuition', baseAmount: '50000', dueDate: '2026-04-05', outstandingAmount: '10000' })],
        rules: [],
        asOfDate: '2026-04-20',
        lateFee: { mode: 'PERCENTAGE', graceDays: 0, percent: '2' },
      }),
    );
    // 2% of the 10,000 still unpaid, not of the 50,000 originally demanded.
    expect(result.items[0]!.lateFeeAmount).toBe('200.0000');
  });

  it('prefers an explicit late-fee rule over the tenant default', () => {
    const result = calculateFees(
      request({
        items: [TUITION()],
        asOfDate: '2026-04-20',
        lateFee: { mode: 'PER_DAY', graceDays: 0, perDayAmount: '100' },
        rules: [
          rule({
            code: 'SCHOLAR_NO_LATE',
            policyType: 'LATE_FEE',
            stage: 'LATE_FEE',
            actions: [{ kind: 'REMOVE_LATE_FEE' }],
            conditions: { kind: 'condition', field: 'student.category', operator: 'EQ', value: 'SCHOLARSHIP' },
          }),
        ],
        context: { evaluationDate: '2026-04-20', student: { id: 'stu-1', category: 'SCHOLARSHIP' } },
      }),
    );
    // The rule wins, so the tenant per-day late fee is not also applied.
    expect(result.items[0]!.lateFeeAmount).toBe('0.0000');
    expect(result.items[0]!.netAmount).toBe('50000.0000');
  });

  it('does not accrue a late fee on a fully waived fee', () => {
    const result = calculateFees(
      request({
        items: [TUITION()],
        asOfDate: '2026-04-20',
        lateFee: { mode: 'PER_DAY', graceDays: 0, perDayAmount: '100' },
        rules: [rule({ code: 'FULL', policyType: 'WAIVER', stage: 'WAIVER', actions: [{ kind: 'WAIVE_FULL' }] })],
      }),
    );
    expect(result.items[0]!.lateFeeAmount).toBe('0.0000');
    expect(result.items[0]!.netAmount).toBe('0.0000');
  });
});

// ---------------------------------------------------------------------------
// Approval, explanation and configuration validation
// ---------------------------------------------------------------------------

describe('fee engine - approval requirements', () => {
  it('flags a rule whose effect needs approval', () => {
    const result = calculateFees(
      request({
        items: [TUITION()],
        rules: [
          rule({
            code: 'BIG_WAIVER',
            policyType: 'WAIVER',
            stage: 'WAIVER',
            requiresApproval: true,
            approvalThreshold: '50000',
            actions: [{ kind: 'WAIVE_PARTIAL', amount: '50000' }],
          }),
        ],
      }),
    );
    expect(result.status).toBe('NEEDS_ATTENTION');
    expect(result.diagnostics.some((d) => d.code === 'APPROVAL_REQUIRED')).toBe(true);
    expect(result.items[0]!.attentionReasons).toContain('Approval required: BIG_WAIVER');
  });

  it('does not flag an adjustment below the approval threshold', () => {
    const result = calculateFees(
      request({
        items: [TUITION()],
        rules: [
          rule({
            code: 'SMALL_WAIVER',
            policyType: 'WAIVER',
            stage: 'WAIVER',
            requiresApproval: true,
            approvalThreshold: '50000',
            actions: [{ kind: 'WAIVE_PARTIAL', amount: '5000' }],
          }),
        ],
      }),
    );
    expect(result.status).toBe('OK');
  });
});

describe('fee engine - explanation', () => {
  it('explains a fee end to end the way an administrator would', () => {
    const result = calculateFees(
      request({
        items: [TUITION()],
        rules: [
          rule({
            code: 'MERIT50',
            name: 'Merit Scholarship',
            policyType: 'SCHOLARSHIP',
            stage: 'SCHOLARSHIP',
            priority: 10,
            actions: [{ kind: 'DISCOUNT_PERCENTAGE', amountBasis: 'BASE_AMOUNT', percentage: '40' }],
          }),
          rule({
            code: 'SIBLING',
            name: 'Sibling Concession',
            policyType: 'CONCESSION',
            stage: 'CONCESSION',
            priority: 20,
            actions: [{ kind: 'DISCOUNT_FIXED', amount: '5000' }],
          }),
          rule({
            code: 'LAB_SURCHARGE',
            name: 'Special Lab Charge',
            policyType: 'SURCHARGE',
            stage: 'SURCHARGE',
            priority: 5,
            actions: [{ kind: 'ADD_FIXED_AMOUNT', amount: '2000' }],
          }),
        ],
      }),
    );

    // 50,000 + 2,000 surcharge = 52,000; -20,000 scholarship; -5,000 concession.
    expect(result.totals.surchargeAmount).toBe('2000.0000');
    expect(result.totals.scholarshipAmount).toBe('20000.0000');
    expect(result.totals.concessionAmount).toBe('5000.0000');
    expect(result.totals.netAmount).toBe('27000.0000');

    const explanation = explainItem(result.items[0]!);
    expect(explanation.baseAmount).toBe('50000.0000');
    expect(explanation.finalAmount).toBe('27000.0000');
    expect(explanation.steps.map((step) => step.label)).toContain('+ Special Lab Charge');
    expect(explanation.steps.map((step) => step.label)).toContain('- Merit Scholarship');
    expect(explanation.steps.map((step) => step.label)).toContain('- Sibling Concession');

    const text = renderItemExplanationText(result.items[0]!);
    expect(text).toContain('Net payable');
    expect(text).toContain('27,000.00');
  });
});

describe('rule set validation', () => {
  it('rejects an impossible effective date range', () => {
    const issues = validateRuleSet([
      rule({
        code: 'BAD_DATES',
        policyType: 'DISCOUNT',
        stage: 'DISCOUNT',
        actions: [{ kind: 'DISCOUNT_FIXED', amount: '100' }],
        effectiveFrom: '2026-06-01',
        effectiveTo: '2026-05-01',
      }),
    ]);
    expect(issues.some((issue) => issue.code === 'IMPOSSIBLE_DATE_RANGE')).toBe(true);
    expect(hasBlockingIssues(issues)).toBe(true);
  });

  it('rejects a rule with no actions', () => {
    const issues = validateRuleSet([
      rule({ code: 'EMPTY', policyType: 'DISCOUNT', stage: 'DISCOUNT', actions: [] }),
    ]);
    expect(issues.some((issue) => issue.code === 'NO_ACTIONS')).toBe(true);
  });

  it('rejects an action that is missing the value it needs', () => {
    const issues = validateRuleSet([
      rule({ code: 'NO_PCT', policyType: 'DISCOUNT', stage: 'DISCOUNT', actions: [{ kind: 'DISCOUNT_PERCENTAGE' }] }),
      rule({ code: 'NO_AMT', policyType: 'DISCOUNT', stage: 'DISCOUNT', actions: [{ kind: 'DISCOUNT_FIXED' }] }),
    ]);
    expect(issues.some((issue) => issue.code === 'ACTION_MISSING_PERCENTAGE')).toBe(true);
    expect(issues.some((issue) => issue.code === 'ACTION_MISSING_AMOUNT')).toBe(true);
  });

  it('rejects a condition on a field the engine does not know', () => {
    const issues = validateRuleSet([
      rule({
        code: 'TYPO',
        policyType: 'DISCOUNT',
        stage: 'DISCOUNT',
        actions: [{ kind: 'DISCOUNT_FIXED', amount: '100' }],
        conditions: { kind: 'condition', field: 'student.favouriteColour', operator: 'EQ', value: 'blue' },
      }),
    ]);
    expect(issues.some((issue) => issue.code === 'UNKNOWN_CONDITION_FIELD')).toBe(true);
  });

  it('rejects an invalid fee type reference', () => {
    const issues = validateRuleSet(
      [
        rule({
          code: 'GHOST',
          policyType: 'DISCOUNT',
          stage: 'DISCOUNT',
          actions: [{ kind: 'DISCOUNT_FIXED', amount: '100', feeTypeCodes: ['TUTION'] }],
        }),
      ],
      { knownFeeTypeCodes: ['TUITION', 'LAB'] },
    );
    expect(issues.some((issue) => issue.code === 'UNKNOWN_FEE_TYPE_REFERENCE')).toBe(true);
  });

  it('warns about a duplicate priority conflict inside a group', () => {
    const issues = validateRuleSet([
      rule({ code: 'A', policyType: 'DISCOUNT', stage: 'DISCOUNT', priority: 50, arbitrationGroup: 'g', actions: [{ kind: 'DISCOUNT_FIXED', amount: '100' }] }),
      rule({ code: 'B', policyType: 'DISCOUNT', stage: 'DISCOUNT', priority: 50, arbitrationGroup: 'g', actions: [{ kind: 'DISCOUNT_FIXED', amount: '200' }] }),
    ]);
    expect(issues.some((issue) => issue.code === 'DUPLICATE_PRIORITY_CONFLICT')).toBe(true);
  });

  it('warns when a rule tests an amount an earlier stage already changed', () => {
    const issues = validateRuleSet([
      rule({
        code: 'ORDER_DEPENDENT',
        policyType: 'DISCOUNT',
        stage: 'DISCOUNT',
        actions: [{ kind: 'DISCOUNT_FIXED', amount: '100' }],
        conditions: { kind: 'condition', field: 'fee.amount', operator: 'GT', value: '1000', valueType: 'NUMBER' },
      }),
    ]);
    expect(issues.some((issue) => issue.code === 'ORDER_SENSITIVE_CONDITION')).toBe(true);
  });

  it('warns about an active rule whose window has already closed', () => {
    const issues = validateRuleSet(
      [
        rule({
          code: 'STALE',
          policyType: 'DISCOUNT',
          stage: 'DISCOUNT',
          actions: [{ kind: 'DISCOUNT_FIXED', amount: '100' }],
          effectiveFrom: '2024-01-01',
          effectiveTo: '2024-12-31',
        }),
      ],
      { asOfDate: '2026-04-01' },
    );
    expect(issues.some((issue) => issue.code === 'EXPIRED_RULE_STILL_ACTIVE')).toBe(true);
  });

  it('passes a well-formed rule set', () => {
    const issues = validateRuleSet(
      [
        rule({
          code: 'MERIT50',
          policyType: 'SCHOLARSHIP',
          stage: 'SCHOLARSHIP',
          requiresApproval: true,
          actions: [{ kind: 'DISCOUNT_PERCENTAGE', amountBasis: 'BASE_AMOUNT', percentage: '50', feeTypeCodes: ['TUITION'] }],
          conditions: { kind: 'condition', field: 'student.academicScore', operator: 'GTE', value: 90, valueType: 'NUMBER' },
        }),
      ],
      { knownFeeTypeCodes: ['TUITION'], asOfDate: '2026-04-01' },
    );
    expect(issues.filter((issue) => issue.severity === 'ERROR')).toEqual([]);
  });
});

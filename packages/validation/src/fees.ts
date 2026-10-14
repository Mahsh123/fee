import {
  FEE_CALCULATION_METHODS,
  FEE_CATEGORY_KINDS,
  FEE_FREQUENCIES,
  FEE_OPTIONALITIES,
  ASSIGNMENT_TARGET_TYPES,
  POLICY_TYPES,
  STACKING_MODES,
  CONDITION_OPERATORS,
  ACTION_KINDS,
  ACTION_AMOUNT_BASES,
  CALCULATION_STAGES,
} from '@fee/types';
import { z } from 'zod';

const uuid = z.string().uuid();
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const money = z.string().regex(/^\d{1,14}(?:\.\d{1,4})?$/, 'Use a non-negative amount with up to four decimal places.');
const percent = z.string().regex(/^\d{1,3}(?:\.\d{1,6})?$/, 'Use a percentage with up to six decimal places.').refine((v) => Number(v) <= 100, 'Percentage cannot exceed 100.');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((v) => {
  const parsed = new Date(`${v}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === v;
}, 'Enter a valid calendar date.');
const metadata = z.record(z.string(), z.unknown()).nullable().optional();
const calculationConfig = z.discriminatedUnion('kind', [
  z.object({ schemaVersion: z.literal(1), kind: z.literal('USAGE'), quantityPath: z.string().trim().min(1).max(100).regex(/^[A-Za-z_][A-Za-z0-9_.]*$/) }).strict(),
  z.object({ schemaVersion: z.literal(1), kind: z.literal('FORMULA'), expression: z.string().trim().min(1).max(512) }).strict(),
  z.object({ schemaVersion: z.literal(1), kind: z.literal('CUSTOM'), expression: z.string().trim().min(1).max(512) }).strict(),
]);

export const createFeeCategorySchema = z.object({
  name: z.string().trim().min(1).max(120),
  code: z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/),
  kind: z.enum(FEE_CATEGORY_KINDS),
  description: optionalText(1000),
  sortOrder: z.number().int().min(0).max(100000).optional(),
});
export const updateFeeCategorySchema = createFeeCategorySchema.partial().extend({ active: z.boolean().optional() });

const feeTypeConfiguration = z.object({
  calculationMethod: z.enum(FEE_CALCULATION_METHODS),
  defaultFrequency: z.enum(FEE_FREQUENCIES),
  optionality: z.enum(FEE_OPTIONALITIES),
  taxable: z.boolean().optional(),
  taxPercent: percent.nullable().optional(),
  applicabilityRule: z.record(z.string(), z.unknown()).nullable().optional(),
  calculationConfig: calculationConfig.nullable().optional(),
});

function validateCalculationMethodConfig(
  value: { calculationMethod: string; calculationConfig?: { kind: string } | null },
  context: z.RefinementCtx,
) {
  const method = value.calculationMethod;
  const config = value.calculationConfig;
  if (method === 'USAGE' && config?.kind !== 'USAGE') {
    context.addIssue({ code: 'custom', path: ['calculationConfig'], message: 'Choose a numeric usage quantity field.' });
  } else if ((method === 'FORMULA' || method === 'CUSTOM') && config?.kind !== method) {
    context.addIssue({ code: 'custom', path: ['calculationConfig'], message: 'Enter a safe calculation expression for this method.' });
  } else if (!['USAGE', 'FORMULA', 'CUSTOM'].includes(method) && config) {
    context.addIssue({ code: 'custom', path: ['calculationConfig'], message: 'Only usage, formula, and custom methods use an additional calculation configuration.' });
  }
}

export const createFeeTypeSchema = z.object({
  categoryId: uuid,
  name: z.string().trim().min(1).max(120),
  code: z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/),
  description: optionalText(1000),
  priority: z.number().int().min(0).max(100000).optional(),
  ...feeTypeConfiguration.shape,
}).superRefine(validateCalculationMethodConfig);
export const updateFeeTypeSchema = z.object({
  categoryId: uuid.optional(),
  name: z.string().trim().min(1).max(120).optional(),
  description: optionalText(1000),
  priority: z.number().int().min(0).max(100000).optional(),
  active: z.boolean().optional(),
});
export const createFeeTypeVersionSchema = feeTypeConfiguration.extend({
  effectiveFrom: date,
  effectiveTo: date.nullable().optional(),
}).superRefine(validateCalculationMethodConfig);
export const closeFeeTypeVersionSchema = z.object({
  effectiveTo: date,
  reason: z.string().trim().min(1).max(1000),
});

export const feeStructureItemSchema = z.object({
  feeTypeId: uuid,
  amount: money,
  quantity: z.string().regex(/^\d{1,8}(?:\.\d{1,4})?$/).nullable().optional(),
  percentBase: money.nullable().optional(),
  frequency: z.enum(FEE_FREQUENCIES),
  optionality: z.enum(FEE_OPTIONALITIES).optional(),
  taxable: z.boolean().optional(),
  taxPercent: percent.nullable().optional(),
  dueDate: date.nullable().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
});

const feeStructureFields = {
  name: z.string().trim().min(1).max(160),
  code: z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/),
  description: optionalText(1000),
  academicYearId: uuid.nullable().optional(),
  targetType: z.enum(ASSIGNMENT_TARGET_TYPES).optional(),
  targetUnitId: uuid.nullable().optional(),
  priority: z.number().int().min(0).max(100000).optional(),
};

export const createFeeStructureSchema = z.object({
  ...feeStructureFields,
  effectiveFrom: date,
  effectiveTo: date.nullable().optional(),
  notes: optionalText(2000),
  items: z.array(feeStructureItemSchema).min(1).max(200),
});
export const updateFeeStructureSchema = z.object({
  name: feeStructureFields.name.optional(),
  description: optionalText(1000),
  priority: feeStructureFields.priority,
  active: z.boolean().optional(),
});
export const createFeeStructureVersionSchema = z.object({
  effectiveFrom: date,
  effectiveTo: date.nullable().optional(),
  notes: optionalText(2000),
  items: z.array(feeStructureItemSchema).min(1).max(200),
});
export const closeFeeStructureVersionSchema = z.object({
  effectiveTo: date,
  reason: z.string().trim().min(1).max(1000),
});

type PolicyConditionInput =
  | { kind: 'condition'; field: string; operator: (typeof CONDITION_OPERATORS)[number]; value?: unknown; valueType?: 'STRING' | 'NUMBER' | 'BOOLEAN' | 'DATE' | 'ENUM'; negate?: boolean }
  | { kind: 'group'; op: 'AND' | 'OR'; children: PolicyConditionInput[]; negate?: boolean };
const policyConditionSchema: z.ZodType<PolicyConditionInput> = z.lazy(() => z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('condition'), field: z.string().trim().min(1).max(160), operator: z.enum(CONDITION_OPERATORS), value: z.unknown().optional(), valueType: z.enum(['STRING', 'NUMBER', 'BOOLEAN', 'DATE', 'ENUM']).optional(), negate: z.boolean().optional() }),
  z.object({ kind: z.literal('group'), op: z.enum(['AND', 'OR']), children: z.array(policyConditionSchema).min(1).max(50), negate: z.boolean().optional() }),
]));

const policyActionSchema = z.object({
  kind: z.enum(ACTION_KINDS),
  amountBasis: z.enum(ACTION_AMOUNT_BASES).optional(),
  amount: money.nullable().optional(),
  percentage: z.string().regex(/^\d{1,3}(?:\.\d{1,6})?$/).nullable().optional(),
  feeTypeIds: z.array(uuid).max(200).optional(),
  capAmount: money.nullable().optional(),
  floorAmount: money.nullable().optional(),
  dueDate: date.nullable().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
  parameters: z.record(z.string(), z.unknown()).nullable().optional(),
});
const policyScopeSchema = z.object({
  targetType: z.enum(ASSIGNMENT_TARGET_TYPES),
  targetId: uuid.nullable().optional(),
  academicYearId: uuid.nullable().optional(),
  includeChildren: z.boolean().optional(),
});
const policyVersionFields = {
  effectiveFrom: date,
  effectiveTo: date.nullable().optional(),
  conditionTree: policyConditionSchema.nullable().optional(),
  limits: z.object({ maxTotalDiscount: money.nullable().optional(), minNetAmount: money.nullable().optional(), maxNetAmount: money.nullable().optional() }).nullable().optional(),
  actions: z.array(policyActionSchema).min(1).max(100),
  scopes: z.array(policyScopeSchema).max(100).optional(),
};
export const createFeePolicySchema = z.object({
  name: z.string().trim().min(1).max(160),
  code: z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/),
  description: optionalText(1000),
  policyType: z.enum(POLICY_TYPES),
  stackingMode: z.enum(STACKING_MODES),
  priority: z.number().int().min(0).max(100000).optional(),
  stage: z.enum(CALCULATION_STAGES),
  arbitrationGroup: optionalText(120),
  requiresApproval: z.boolean().optional(),
  approvalThreshold: money.nullable().optional(),
  explainTemplate: optionalText(500),
  version: z.object(policyVersionFields),
});
export const createFeePolicyVersionSchema = z.object(policyVersionFields);
export const updateFeePolicySchema = z.object({ name: z.string().trim().min(1).max(160).optional(), description: optionalText(1000), priority: z.number().int().min(0).max(100000).optional(), stage: z.enum(CALCULATION_STAGES).optional(), active: z.boolean().optional(), explainTemplate: optionalText(500) });
export const feePolicyPreviewSchema = z.object({
  versionId: uuid.optional(),
  request: z.object({
    asOfDate: date,
    context: z.object({ student: z.record(z.string(), z.unknown()), evaluationDate: date }).passthrough(),
    items: z.array(z.object({
      key: z.string().min(1).max(160), feeTypeId: uuid.optional(), feeTypeCode: z.string().min(1).max(32), feeTypeName: z.string().min(1).max(160),
      feeCategoryCode: z.string().max(32).optional(), feeTypeVersionId: uuid.optional(), sequence: z.number().int().min(0),
      frequency: z.enum(FEE_FREQUENCIES), optionality: z.enum(FEE_OPTIONALITIES), baseAmount: money,
      quantity: z.string().regex(/^\d{1,8}(?:\.\d{1,4})?$/).optional(), rate: money.optional(), taxable: z.boolean().optional(), taxPercent: percent.optional(), dueDate: date.optional(),
    })).min(1).max(200),
    allowNegativeTotal: z.boolean().optional(), minimumPayable: money.nullable().optional(),
  }),
});

const installmentDateFields = { label: z.string().trim().min(1).max(120), dueDate: date };
const installmentPercentageRule = z.object({
  basis: z.literal('PERCENTAGE'),
  installments: z.array(z.object({ ...installmentDateFields, percentage: percent })).min(1).max(60),
});
const installmentAmountRule = z.object({
  basis: z.literal('FIXED_AMOUNT'),
  installments: z.array(z.object({ ...installmentDateFields, amount: money.refine(positiveMoney, 'Installment amount must be greater than zero.') })).min(1).max(60),
});
const installmentCustomRule = z.object({
  basis: z.literal('CUSTOM_SCHEDULE'),
  installments: z.array(z.object({ ...installmentDateFields, percentage: percent })).min(1).max(60),
});
export const installmentRuleSchema = z.discriminatedUnion('basis', [installmentPercentageRule, installmentAmountRule, installmentCustomRule]).superRefine((rule, context) => {
  if (rule.basis === 'FIXED_AMOUNT') return;
  const units = rule.installments.reduce((sum, row) => sum + percentUnits(row.percentage), 0n);
  if (units !== 100_000_000n) context.addIssue({ code: 'custom', path: ['installments'], message: 'Installment percentages must add up to exactly 100%.' });
});

export const createFeeAssignmentSchema = z.object({
  branchId: uuid,
  feeStructureId: uuid,
  feeStructureVersionId: uuid,
  targetType: z.enum(ASSIGNMENT_TARGET_TYPES),
  targetId: uuid.nullable().optional(),
  targetStudentIds: z.array(uuid).max(5000).optional(),
  targetPersonIds: z.array(uuid).max(5000).optional(),
  academicYearId: uuid.nullable().optional(),
  dueDateOverride: date.nullable().optional(),
  installmentRule: installmentRuleSchema.nullable().optional(),
}).superRefine((value, context) => {
  if (value.targetType === 'STUDENT' && !value.targetStudentIds?.length) context.addIssue({ code: 'custom', path: ['targetStudentIds'], message: 'Select at least one student for a student-targeted assignment.' });
  if (value.targetType === 'PERSON' && !value.targetPersonIds?.length && !value.targetId) context.addIssue({ code: 'custom', path: ['targetPersonIds'], message: 'Select people or choose a people group for this assignment.' });
  if (value.targetType === 'PERSON' && value.targetPersonIds?.length && value.targetId) context.addIssue({ code: 'custom', path: ['targetId'], message: 'Choose either a people group or specific people, not both.' });
  if (value.targetType === 'PERSON' && value.academicYearId) context.addIssue({ code: 'custom', path: ['academicYearId'], message: 'Academic year is only used by education-specific student assignments.' });
  if (value.targetType === 'CUSTOM_GROUP' && !value.targetId) context.addIssue({ code: 'custom', path: ['targetId'], message: 'Select a student group for this assignment.' });
});
export const updateFeeAssignmentSchema = z.object({ dueDateOverride: date.nullable(), branchId: uuid.optional() });

export const generateFeeAssignmentCycleSchema = z.object({
  frequency: z.enum(['ONE_TIME', 'MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUAL', 'TERM', 'SEMESTER']),
  periodStart: date,
  periodEnd: date,
  dueDate: date,
  usageInputs: z.array(z.object({
    personId: uuid,
    feeStructureItemId: uuid,
    quantity: z.string().regex(/^\d{1,8}(?:\.\d{1,4})?$/, 'Enter a non-negative quantity with up to four decimal places.'),
  }).strict()).max(10_000),
}).strict().superRefine((value, context) => {
  if (value.periodEnd < value.periodStart) context.addIssue({ code: 'custom', path: ['periodEnd'], message: 'The billing period end must be on or after its start.' });
  if (value.dueDate < value.periodStart) context.addIssue({ code: 'custom', path: ['dueDate'], message: 'The due date cannot be before the billing period starts.' });
  const keys = new Set<string>();
  value.usageInputs.forEach((input, index) => {
    const key = `${input.personId}:${input.feeStructureItemId}`;
    if (keys.has(key)) context.addIssue({ code: 'custom', path: ['usageInputs', index], message: 'A person can have only one quantity for each fee item in a billing cycle.' });
    keys.add(key);
  });
});


export type CreateFeeCategoryInput = z.infer<typeof createFeeCategorySchema>;
export type UpdateFeeCategoryInput = z.infer<typeof updateFeeCategorySchema>;
export type CreateFeeTypeInput = z.infer<typeof createFeeTypeSchema>;
export type UpdateFeeTypeInput = z.infer<typeof updateFeeTypeSchema>;
export type CreateFeeTypeVersionInput = z.infer<typeof createFeeTypeVersionSchema>;
export type CloseFeeTypeVersionInput = z.infer<typeof closeFeeTypeVersionSchema>;
export type FeeStructureItemInput = z.infer<typeof feeStructureItemSchema>;
export type CreateFeeStructureInput = z.infer<typeof createFeeStructureSchema>;
export type UpdateFeeStructureInput = z.infer<typeof updateFeeStructureSchema>;
export type CreateFeeStructureVersionInput = z.infer<typeof createFeeStructureVersionSchema>;
export type CloseFeeStructureVersionInput = z.infer<typeof closeFeeStructureVersionSchema>;
export type CreateFeePolicyInput = z.infer<typeof createFeePolicySchema>;
export type CreateFeePolicyVersionInput = z.infer<typeof createFeePolicyVersionSchema>;
export type UpdateFeePolicyInput = z.infer<typeof updateFeePolicySchema>;
export type FeePolicyPreviewInput = z.infer<typeof feePolicyPreviewSchema>;
export type CreateFeeAssignmentInput = z.infer<typeof createFeeAssignmentSchema>;
export type UpdateFeeAssignmentInput = z.infer<typeof updateFeeAssignmentSchema>;
export type GenerateFeeAssignmentCycleInput = z.infer<typeof generateFeeAssignmentCycleSchema>;
export type InstallmentRuleInput = z.infer<typeof installmentRuleSchema>;

function percentUnits(value: string): bigint {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * 1_000_000n + BigInt((fraction + '000000').slice(0, 6));
}

function positiveMoney(value: string): boolean { return BigInt(value.replace('.', '')) > 0n; }

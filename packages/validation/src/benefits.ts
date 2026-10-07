import { z } from 'zod';
import { STACKING_MODES } from '@fee/types';

const uuid = z.string().uuid();
const money = z.string().regex(/^\d{1,14}(?:\.\d{1,4})?$/).refine((value) => Number(value) > 0, 'Amount must be greater than zero.');
const percentage = z.string().regex(/^(?:100(?:\.0{1,6})?|\d{1,2}(?:\.\d{1,6})?|0?\.\d{1,6})$/);
const nonNegativeAmount = z.string().regex(/^\d{1,14}(?:\.\d{1,4})?$/).refine((value) => Number(value) >= 0, 'Amount must be zero or greater.');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Enter a valid calendar date.');
const instrumentType = z.enum(['SCHOLARSHIP', 'DISCOUNT', 'CONCESSION', 'WAIVER', 'SURCHARGE']);

const benefitInstrumentBase = z.object({
  instrumentType,
  name: z.string().trim().min(1).max(160),
  code: z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/),
  kind: z.enum(['FULL', 'PERCENTAGE', 'FIXED_AMOUNT', 'FEE_SPECIFIC', 'TERM_SPECIFIC', 'YEAR_SPECIFIC']).optional(),
  reason: z.string().trim().min(1).max(500).optional(),
  funder: z.string().trim().max(160).nullable().optional(),
  policyId: uuid.nullable().optional(),
  percentage: percentage.nullable().optional(),
  fixedAmount: money.nullable().optional(),
  maxAmount: money.nullable().optional(),
  feeTypeIds: z.array(uuid).max(500).refine((ids) => new Set(ids).size === ids.length, 'Choose each fee type only once.').optional(),
  academicYearId: uuid.nullable().optional(),
  stackingMode: z.enum(STACKING_MODES).optional(),
  priority: z.number().int().min(0).max(100000).optional(),
  effectiveFrom: date,
  effectiveTo: date.nullable().optional(),
  requiresApproval: z.boolean().optional(),
  fullWaiver: z.boolean().optional(),
  taxable: z.boolean().optional(),
  taxPercent: percentage.nullable().optional(),
  mandatory: z.boolean().optional(),
  active: z.boolean().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
});

export const createBenefitInstrumentSchema = benefitInstrumentBase.superRefine((input, context) => {
  if (input.effectiveTo && input.effectiveTo < input.effectiveFrom) context.addIssue({ code: 'custom', path: ['effectiveTo'], message: 'The end date must be on or after the start date.' });
  if (input.percentage && input.fixedAmount) context.addIssue({ code: 'custom', path: ['fixedAmount'], message: 'Choose a fixed amount or a percentage, not both.' });
  const fullScholarship = input.instrumentType === 'SCHOLARSHIP' && input.kind === 'FULL';
  const fullWaiver = input.instrumentType === 'WAIVER' && input.fullWaiver;
  const needsAmount = !fullScholarship && !fullWaiver;
  if (needsAmount && !input.percentage && !input.fixedAmount) context.addIssue({ code: 'custom', path: ['fixedAmount'], message: 'Enter a fixed amount or percentage.' });
  if (fullScholarship && (input.percentage || input.fixedAmount)) context.addIssue({ code: 'custom', path: ['fixedAmount'], message: 'A full scholarship does not need an amount.' });
  if (fullWaiver && (input.percentage || input.fixedAmount)) context.addIssue({ code: 'custom', path: ['fixedAmount'], message: 'A full waiver does not need an amount.' });
  if (input.instrumentType === 'SCHOLARSHIP' && !input.kind) context.addIssue({ code: 'custom', path: ['kind'], message: 'Choose a scholarship type.' });
  if (input.instrumentType === 'SCHOLARSHIP' && input.kind === 'PERCENTAGE' && !input.percentage) context.addIssue({ code: 'custom', path: ['percentage'], message: 'Enter the scholarship percentage.' });
  if (input.instrumentType === 'SCHOLARSHIP' && input.kind === 'FIXED_AMOUNT' && !input.fixedAmount) context.addIssue({ code: 'custom', path: ['fixedAmount'], message: 'Enter the scholarship amount.' });
  if (input.instrumentType === 'DISCOUNT' || input.instrumentType === 'CONCESSION' || input.instrumentType === 'WAIVER' || input.instrumentType === 'SURCHARGE') {
    if (!input.reason) context.addIssue({ code: 'custom', path: ['reason'], message: 'Enter the reason or category for this instrument.' });
  }
  if (input.instrumentType === 'SURCHARGE' && input.taxable && !input.taxPercent) context.addIssue({ code: 'custom', path: ['taxPercent'], message: 'Enter a tax percentage for a taxable surcharge.' });
});

export const updateBenefitInstrumentSchema = benefitInstrumentBase.omit({ instrumentType: true }).partial().refine((input) => Object.keys(input).length > 0, 'Provide at least one field to update.');

export const createBenefitAssignmentSchema = z.object({
  instrumentType: z.enum(['SCHOLARSHIP', 'DISCOUNT', 'CONCESSION', 'WAIVER']),
  instrumentId: uuid,
  studentId: uuid.nullable().optional(),
  groupId: uuid.nullable().optional(),
  academicYearId: uuid.nullable().optional(),
  effectiveFrom: date,
  effectiveTo: date.nullable().optional(),
  reason: z.string().trim().min(1).max(1000),
  overridePercentage: percentage.nullable().optional(),
  overrideFixedAmount: money.nullable().optional(),
  overrideMaxAmount: money.nullable().optional(),
  stackingMode: z.enum(STACKING_MODES).optional(),
  priority: z.number().int().min(0).max(100000).optional(),
}).superRefine((input, context) => {
  if (Boolean(input.studentId) === Boolean(input.groupId)) context.addIssue({ code: 'custom', path: ['studentId'], message: 'Choose exactly one student or student group.' });
  if (input.effectiveTo && input.effectiveTo < input.effectiveFrom) context.addIssue({ code: 'custom', path: ['effectiveTo'], message: 'The end date must be on or after the start date.' });
  if (input.overridePercentage && input.overrideFixedAmount) context.addIssue({ code: 'custom', path: ['overrideFixedAmount'], message: 'Choose an override amount or percentage, not both.' });
});

export const benefitAssignmentDecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT', 'ARCHIVE']),
  reason: z.string().trim().min(1).max(1000),
});

export const createFeeOverrideSchema = z.object({
  studentId: uuid,
  feeTypeId: uuid,
  originalAmount: money,
  overrideAmount: nonNegativeAmount,
  reason: z.string().trim().min(1).max(1000),
  academicYearId: uuid.nullable().optional(),
  effectiveFrom: date,
  effectiveTo: date.nullable().optional(),
  requiresApproval: z.boolean().default(true),
}).superRefine((input, context) => {
  if (input.effectiveTo && input.effectiveTo < input.effectiveFrom) context.addIssue({ code: 'custom', path: ['effectiveTo'], message: 'The end date must be on or after the start date.' });
});

export const feeOverrideDecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT', 'ARCHIVE']),
  reason: z.string().trim().min(1).max(1000),
});

export type CreateBenefitInstrumentInput = z.infer<typeof createBenefitInstrumentSchema>;
export type UpdateBenefitInstrumentInput = z.infer<typeof updateBenefitInstrumentSchema>;
export type CreateBenefitAssignmentInput = z.infer<typeof createBenefitAssignmentSchema>;
export type BenefitAssignmentDecisionInput = z.infer<typeof benefitAssignmentDecisionSchema>;
export type CreateFeeOverrideInput = z.infer<typeof createFeeOverrideSchema>;
export type FeeOverrideDecisionInput = z.infer<typeof feeOverrideDecisionSchema>;

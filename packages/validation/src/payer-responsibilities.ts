import { PAYER_TYPES } from '@fee/types';
import { z } from 'zod';

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}, 'Enter a valid calendar date.');
const value = z.string().regex(/^\d{1,14}(?:\.\d{1,4})?$/).refine((amount) => Number(amount) > 0, 'Enter a positive amount or percentage.');

export const createPayerResponsibilityRuleSchema = z.object({
  code: z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().trim().min(1).max(160),
  payerType: z.enum(PAYER_TYPES),
  payerName: z.string().trim().max(160).nullable().optional(),
  payerSponsorId: uuid.nullable().optional(),
  payerGuardianId: uuid.nullable().optional(),
  studentId: uuid.nullable().optional(),
  studentGroupId: uuid.nullable().optional(),
  academicYearId: uuid.nullable().optional(),
  feeTypeId: uuid.nullable().optional(),
  basis: z.enum(['FIXED_PER_FEE_ITEM', 'PERCENTAGE_OF_REMAINDER']),
  value,
  priority: z.number().int().min(0).max(100000).optional(),
  effectiveFrom: date,
  effectiveTo: date.nullable().optional(),
}).superRefine((input, context) => {
  if (input.payerType === 'STUDENT') context.addIssue({ code: 'custom', path: ['payerType'], message: 'The student automatically receives any unassigned balance.' });
  if (input.payerType === 'SPONSOR' && !input.payerSponsorId) context.addIssue({ code: 'custom', path: ['payerSponsorId'], message: 'Choose the sponsor that will cover this share.' });
  if (input.payerType !== 'SPONSOR' && input.payerSponsorId) context.addIssue({ code: 'custom', path: ['payerSponsorId'], message: 'A sponsor reference is only valid for a sponsor payer.' });
  const guardianPayer = input.payerType === 'PARENT' || input.payerType === 'GUARDIAN';
  if (guardianPayer && !input.payerGuardianId) context.addIssue({ code: 'custom', path: ['payerGuardianId'], message: 'Choose the linked guardian who will cover this share.' });
  if (!guardianPayer && input.payerGuardianId) context.addIssue({ code: 'custom', path: ['payerGuardianId'], message: 'A guardian reference is only valid for a parent or guardian payer.' });
  if (input.payerType !== 'SPONSOR' && !guardianPayer && !input.payerName?.trim()) context.addIssue({ code: 'custom', path: ['payerName'], message: 'Enter the name shown on the demand for this payer.' });
  if (input.basis === 'PERCENTAGE_OF_REMAINDER' && Number(input.value) > 100) context.addIssue({ code: 'custom', path: ['value'], message: 'A percentage cannot exceed 100.' });
  if (input.effectiveTo && input.effectiveTo < input.effectiveFrom) context.addIssue({ code: 'custom', path: ['effectiveTo'], message: 'The end date must be on or after the start date.' });
  if (input.studentId && input.studentGroupId) context.addIssue({ code: 'custom', path: ['studentGroupId'], message: 'Choose either one student or one student group.' });
});

export const updatePayerResponsibilityRuleSchema = z.object({ active: z.boolean() });

export type CreatePayerResponsibilityRuleInput = z.infer<typeof createPayerResponsibilityRuleSchema>;

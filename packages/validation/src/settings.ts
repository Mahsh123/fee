import { LATE_FEE_MODES, OVERPAYMENT_POLICIES, PARTIAL_PAYMENT_POLICIES, ROUNDING_MODES } from '@fee/types';
import { z } from 'zod';

const uuid = z.string().uuid();
const amount = z.string().regex(/^\d{1,14}(?:\.\d{1,4})?$/, 'Use a non-negative amount with up to four decimal places.');
const percent = z.string().regex(/^\d{1,3}(?:\.\d{1,6})?$/, 'Use a percentage with up to six decimal places.').refine((value) => Number(value) <= 100, 'Percentage cannot exceed 100.');

export const tenantSettingsUpdateSchema = z.object({
  currency: z.string().trim().regex(/^[A-Z]{3}$/, 'Use a three-letter currency code.'),
  currencySymbol: z.string().trim().min(1).max(8),
  currencyMinorUnits: z.number().int().min(0).max(4),
  roundingMode: z.enum(ROUNDING_MODES),
  timezone: z.string().trim().min(1).max(64),
  locale: z.string().trim().min(2).max(32),
  dateFormat: z.string().trim().min(2).max(32),
  defaultAcademicYearId: uuid.nullable().optional(),
  lateFeeMode: z.enum(LATE_FEE_MODES),
  lateFeeGraceDays: z.number().int().min(0).max(365),
  lateFeeFlatAmount: amount,
  lateFeePerDay: amount,
  lateFeePercent: percent,
  lateFeeMaxAmount: amount.nullable(),
  lateFeePaymentTermDays: z.number().int().min(0).max(365),
  lateFeeFeeTypeId: uuid.nullable(),
  partialPaymentPolicy: z.enum(PARTIAL_PAYMENT_POLICIES),
  overpaymentPolicy: z.enum(OVERPAYMENT_POLICIES),
  allowAdvancePayment: z.boolean(),
  minimumPartialAmount: amount.nullable(),
  refundApprovalThreshold: amount.nullable(),
  waiverApprovalThreshold: amount.nullable(),
  adjustmentApprovalThreshold: amount.nullable(),
  reminderScheduleDays: z.array(z.number().int().min(0).max(365)).max(20),
  allowNegativeDemand: z.boolean(),
  allowPublicRegistration: z.boolean().optional(),
});

export const accrueLateFeesSchema = z.object({
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
  }, 'Enter a valid calendar date.'),
  cursor: uuid.optional(),
});

export type TenantSettingsUpdateInput = z.infer<typeof tenantSettingsUpdateSchema>;
export type AccrueLateFeesInput = z.infer<typeof accrueLateFeesSchema>;

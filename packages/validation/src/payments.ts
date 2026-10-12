import { PAYMENT_METHOD_KINDS, PAYER_TYPES } from '@fee/types';
import { z } from 'zod';

const uuid = z.string().uuid();
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const money = z.string().regex(/^\d{1,14}(?:\.\d{1,4})?$/).refine((value) => Number(value) > 0, 'Amount must be greater than zero.');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}, 'Enter a valid calendar date.');

export const createPaymentMethodSchema = z.object({
  kind: z.enum(PAYMENT_METHOD_KINDS),
  name: z.string().trim().min(1).max(120),
  code: z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/),
  requiresReference: z.boolean().optional(),
  requiresInstrument: z.boolean().optional(),
  enabledForManual: z.boolean().optional(),
  enabledForOnline: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
});

export const updatePaymentMethodSchema = createPaymentMethodSchema.omit({ kind: true, code: true }).partial().extend({
  active: z.boolean().optional(),
});

export const approvalDecisionSchema = z.object({
  approved: z.boolean(),
  note: optionalText(1000),
});

export const manualPaymentSchema = z.object({
  idempotencyKey: uuid,
  studentId: uuid,
  methodId: uuid,
  amount: money,
  currency: z.string().length(3).regex(/^[A-Z]{3}$/).optional(),
  demandItemIds: z.array(uuid).min(1).max(500).optional(),
  paidAt: z.string().datetime({ offset: true }).optional(),
  valueDate: date.optional(),
  payerType: z.enum(PAYER_TYPES).optional(),
  payerName: optionalText(200),
  payerPhone: optionalText(40),
  payerEmail: z.string().email().max(254).nullable().optional(),
  payerSponsorId: uuid.nullable().optional(),
  payerGuardianId: uuid.nullable().optional(),
  referenceNumber: optionalText(120),
  instrumentNumber: optionalText(120),
  bankName: optionalText(120),
  branchName: optionalText(120),
  instrumentDate: date.optional(),
  remarks: optionalText(1000),
}).superRefine((input, context) => {
  if (input.payerType === 'SPONSOR' && !input.payerSponsorId) {
    context.addIssue({ code: 'custom', path: ['payerSponsorId'], message: 'Choose the sponsor that made this payment.' });
  }
  if (input.payerType !== 'SPONSOR' && input.payerSponsorId) {
    context.addIssue({ code: 'custom', path: ['payerSponsorId'], message: 'A sponsor may only be attached to a sponsor payment.' });
  }
  const guardianPayer = input.payerType === 'PARENT' || input.payerType === 'GUARDIAN';
  if (guardianPayer && !input.payerGuardianId) context.addIssue({ code: 'custom', path: ['payerGuardianId'], message: 'Choose the linked guardian who made this payment.' });
  if (!guardianPayer && input.payerGuardianId) context.addIssue({ code: 'custom', path: ['payerGuardianId'], message: 'A guardian reference is only valid for a parent or guardian payment.' });
  if (input.payerType && !['STUDENT', 'SPONSOR', 'PARENT', 'GUARDIAN'].includes(input.payerType) && !input.payerName?.trim()) {
    context.addIssue({ code: 'custom', path: ['payerName'], message: 'Enter the name of the parent, guardian, or other payer.' });
  }
  if (input.demandItemIds && new Set(input.demandItemIds).size !== input.demandItemIds.length) {
    context.addIssue({ code: 'custom', path: ['demandItemIds'], message: 'A demand item may be selected only once.' });
  }
});

export const createRefundSchema = z.object({
  idempotencyKey: uuid,
  paymentId: uuid,
  amount: money,
  reason: z.string().trim().min(1).max(1000),
  kind: z.enum(['MANUAL', 'GATEWAY']).default('MANUAL'),
  methodId: uuid.optional(),
  referenceNumber: optionalText(120),
  instrumentNumber: optionalText(120),
  bankName: optionalText(120),
  toCreditBalance: z.boolean().optional().default(false),
}).superRefine((input, context) => {
  if (input.kind === 'MANUAL' && !input.methodId) context.addIssue({ code: 'custom', path: ['methodId'], message: 'Choose a payment method for a manual refund.' });
  if (input.kind === 'GATEWAY' && input.toCreditBalance) context.addIssue({ code: 'custom', path: ['toCreditBalance'], message: 'Gateway refunds are returned to the original payment method, not student credit.' });
  if (input.kind === 'GATEWAY' && (input.referenceNumber || input.instrumentNumber || input.bankName)) context.addIssue({ code: 'custom', path: ['referenceNumber'], message: 'Manual refund instrument details are not used for a gateway refund.' });
});

export const refundDecisionSchema = z.object({ approved: z.boolean(), note: optionalText(1000) });

export const refundReconciliationSchema = z.object({
  outcome: z.enum(['REFUNDED', 'FAILED']),
  providerRefundId: z.string().trim().min(1).max(160).optional(),
  amount: money,
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase()),
  resolution: z.string().trim().min(5).max(1000),
}).superRefine((input, context) => {
  if (input.outcome === 'REFUNDED' && !input.providerRefundId) context.addIssue({ code: 'custom', path: ['providerRefundId'], message: 'Enter the provider refund ID confirmed in the provider dashboard.' });
});

export const applyCreditSchema = z.object({
  idempotencyKey: uuid,
  studentId: uuid,
  amount: money.optional(),
  creditIds: z.array(uuid).min(1).max(500).optional(),
  demandItemIds: z.array(uuid).min(1).max(500).optional(),
}).superRefine((input, context) => {
  if (input.creditIds && new Set(input.creditIds).size !== input.creditIds.length) context.addIssue({ code: 'custom', path: ['creditIds'], message: 'A credit may be selected only once.' });
  if (input.demandItemIds && new Set(input.demandItemIds).size !== input.demandItemIds.length) context.addIssue({ code: 'custom', path: ['demandItemIds'], message: 'A demand item may be selected only once.' });
});

export type CreatePaymentMethodInput = z.infer<typeof createPaymentMethodSchema>;
export type UpdatePaymentMethodInput = z.infer<typeof updatePaymentMethodSchema>;
export type ManualPaymentInput = z.infer<typeof manualPaymentSchema>;
export type CreateRefundInput = z.infer<typeof createRefundSchema>;
export type RefundReconciliationInput = z.infer<typeof refundReconciliationSchema>;
export type ApplyCreditInput = z.infer<typeof applyCreditSchema>;

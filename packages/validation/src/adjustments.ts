import { z } from 'zod';

const uuid = z.string().uuid();
const amount = z.string().regex(/^\d{1,14}(?:\.\d{1,4})?$/).refine((value) => Number(value) > 0, 'Amount must be greater than zero.');

export const OPERATIONAL_ADJUSTMENT_KINDS = ['DEBIT_ADJUSTMENT', 'CREDIT_ADJUSTMENT', 'WRITE_OFF', 'WAIVER', 'CORRECTION'] as const;

export const createAdjustmentSchema = z.object({
  idempotencyKey: uuid,
  demandItemId: uuid,
  installmentItemId: uuid.nullable().optional(),
  kind: z.enum(OPERATIONAL_ADJUSTMENT_KINDS),
  direction: z.enum(['DEBIT', 'CREDIT']).optional(),
  amount,
  reason: z.string().trim().min(1).max(1000),
  policyId: uuid.nullable().optional(),
  instrumentType: z.enum(['SCHOLARSHIP', 'DISCOUNT', 'CONCESSION', 'WAIVER', 'OVERRIDE']).nullable().optional(),
  instrumentId: uuid.nullable().optional(),
}).superRefine((input, context) => {
  const fixedDirection = input.kind === 'DEBIT_ADJUSTMENT' ? 'DEBIT'
    : input.kind === 'CREDIT_ADJUSTMENT' || input.kind === 'WRITE_OFF' || input.kind === 'WAIVER' ? 'CREDIT'
      : undefined;
  if (fixedDirection && input.direction && input.direction !== fixedDirection) {
    context.addIssue({ code: 'custom', path: ['direction'], message: `${input.kind.replaceAll('_', ' ').toLowerCase()} must be a ${fixedDirection.toLowerCase()} adjustment.` });
  }
  if (input.kind === 'CORRECTION' && !input.direction) {
    context.addIssue({ code: 'custom', path: ['direction'], message: 'Choose whether this correction increases or reduces the amount due.' });
  }
  if (input.instrumentId && !input.instrumentType) {
    context.addIssue({ code: 'custom', path: ['instrumentType'], message: 'Choose the instrument type for the linked record.' });
  }
});

export const reverseAdjustmentSchema = z.object({
  idempotencyKey: uuid,
  reason: z.string().trim().min(1).max(1000),
});

export type CreateAdjustmentInput = z.infer<typeof createAdjustmentSchema>;
export type ReverseAdjustmentInput = z.infer<typeof reverseAdjustmentSchema>;

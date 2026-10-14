import { GATEWAY_ENVIRONMENTS, GATEWAY_PROVIDERS, PAYMENT_METHOD_KINDS, PAYER_TYPES } from '@fee/types';
import { z } from 'zod';

const uuid = z.string().uuid();
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const money = z.string().regex(/^\d{1,14}(?:\.\d{1,4})?$/).refine((value) => Number(value) > 0, 'Amount must be greater than zero.');
const routeSchema = z.object({ method: z.enum(PAYMENT_METHOD_KINDS), minAmount: money.optional(), maxAmount: money.optional() }).superRefine((route, context) => {
  if (route.minAmount && route.maxAmount && decimalGreaterThan(route.minAmount, route.maxAmount)) context.addIssue({ code: 'custom', path: ['maxAmount'], message: 'Route maximum must be at least its minimum.' });
});
const extraConfigSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).superRefine((config, context) => {
  for (const key of Object.keys(config)) {
    if (/(secret|password|token|salt|private|credential|api.?key)/i.test(key)) context.addIssue({ code: 'custom', path: [key], message: 'Store credentials in the encrypted credential fields, not provider options.' });
  }
});

const gatewayBaseSchema = z.object({
  provider: z.enum(GATEWAY_PROVIDERS),
  environment: z.enum(GATEWAY_ENVIRONMENTS),
  displayName: z.string().trim().min(1).max(120),
  keyId: z.string().trim().min(1).max(300),
  secret: z.string().min(1).max(2000),
  webhookSecret: z.string().max(2000).optional(),
  enabled: z.boolean().optional(),
  isDefault: z.boolean().optional(),
  isBackup: z.boolean().optional(),
  priority: z.number().int().min(0).max(100000).optional(),
  supportedMethods: z.array(z.enum(PAYMENT_METHOD_KINDS)).min(1).max(PAYMENT_METHOD_KINDS.length),
  routingRules: z.array(routeSchema).max(100).optional(),
  minAmount: money.optional(),
  maxAmount: money.optional(),
  extraConfig: extraConfigSchema.optional(),
});

export const createGatewaySchema = gatewayBaseSchema.superRefine((input, context) => {
  if (input.minAmount && input.maxAmount && decimalGreaterThan(input.minAmount, input.maxAmount)) context.addIssue({ code: 'custom', path: ['maxAmount'], message: 'Gateway maximum must be at least its minimum.' });
});

export const updateGatewaySchema = gatewayBaseSchema.omit({ provider: true, environment: true, keyId: true, secret: true }).partial().extend({
  keyId: z.string().trim().min(1).max(300).optional(),
  secret: z.string().min(1).max(2000).optional(),
  webhookSecret: z.string().max(2000).nullable().optional(),
  active: z.boolean().optional(),
}).superRefine((input, context) => {
  if (input.minAmount && input.maxAmount && decimalGreaterThan(input.minAmount, input.maxAmount)) context.addIssue({ code: 'custom', path: ['maxAmount'], message: 'Gateway maximum must be at least its minimum.' });
});

export const createPaymentOrderSchema = z.object({
  idempotencyKey: uuid,
  studentId: uuid.optional(),
  personId: uuid.optional(),
  methodId: uuid,
  amount: money,
  demandItemIds: z.array(uuid).min(1).max(500).optional(),
  payerType: z.enum(PAYER_TYPES).optional(),
  payerName: optionalText(200),
  payerPhone: optionalText(40),
  payerEmail: z.string().trim().email().max(254).transform((value) => value.toLowerCase()).nullable().optional(),
  payerSponsorId: uuid.nullable().optional(),
  payerGuardianId: uuid.nullable().optional(),
  environment: z.enum(GATEWAY_ENVIRONMENTS).optional(),
}).superRefine((input, context) => {
  if (Boolean(input.studentId) === Boolean(input.personId)) context.addIssue({ code: 'custom', path: ['personId'], message: 'Choose exactly one student or person profile.' });
  if (input.payerType === 'SPONSOR' && !input.payerSponsorId) context.addIssue({ code: 'custom', path: ['payerSponsorId'], message: 'Choose the sponsor that made this payment.' });
  if (input.payerType !== 'SPONSOR' && input.payerSponsorId) context.addIssue({ code: 'custom', path: ['payerSponsorId'], message: 'A sponsor may only be attached to a sponsor payment.' });
  const guardianPayer = input.payerType === 'PARENT' || input.payerType === 'GUARDIAN';
  if (guardianPayer && !input.payerGuardianId) context.addIssue({ code: 'custom', path: ['payerGuardianId'], message: 'Choose the linked guardian who will pay.' });
  if (!guardianPayer && input.payerGuardianId) context.addIssue({ code: 'custom', path: ['payerGuardianId'], message: 'A guardian reference is only valid for a parent or guardian payment.' });
  if (input.payerType && !['STUDENT', 'SPONSOR', 'PARENT', 'GUARDIAN'].includes(input.payerType) && !input.payerName?.trim()) context.addIssue({ code: 'custom', path: ['payerName'], message: 'Enter the name of the parent, guardian, or other payer.' });
  if (input.demandItemIds && new Set(input.demandItemIds).size !== input.demandItemIds.length) context.addIssue({ code: 'custom', path: ['demandItemIds'], message: 'A demand item may be selected only once.' });
});

export type CreateGatewayInput = z.infer<typeof createGatewaySchema>;
export type UpdateGatewayInput = z.infer<typeof updateGatewaySchema>;
export type CreatePaymentOrderInput = z.infer<typeof createPaymentOrderSchema>;

function decimalGreaterThan(left: string, right: string): boolean {
  const toUnits = (value: string) => { const [whole = '0', fraction = ''] = value.split('.'); return BigInt(`${whole}${fraction.padEnd(4, '0')}`); };
  return toUnits(left) > toUnits(right);
}

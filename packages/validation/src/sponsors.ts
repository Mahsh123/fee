import { z } from 'zod';

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const creditLimit = z.string().regex(/^\d{1,14}(?:\.\d{1,4})?$/, 'Enter a non-negative amount with up to four decimal places.').nullable().optional();

export const createSponsorSchema = z.object({
  name: z.string().trim().min(1).max(160),
  code: z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9_-]+$/),
  type: z.string().trim().min(1).max(80),
  contactPerson: optionalText(160),
  phone: optionalText(32),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()).nullable().optional(),
  address: optionalText(1000),
  creditLimit,
});

export const updateSponsorSchema = createSponsorSchema.partial().extend({ active: z.boolean().optional() }).refine((value) => Object.keys(value).length > 0, 'Provide at least one field to update.');

export type CreateSponsorInput = z.infer<typeof createSponsorSchema>;
export type UpdateSponsorInput = z.infer<typeof updateSponsorSchema>;

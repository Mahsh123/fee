import { z } from 'zod';

const uuid = z.string().uuid();
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const personType = z.string().trim().min(1).max(80).regex(/^[A-Za-z][A-Za-z0-9_-]*$/).transform((value) => value.toUpperCase());

export const createTenantPersonSchema = z.object({
  personNumber: z.string().trim().min(1).max(80).optional(),
  typeKey: personType.default('MEMBER'),
  typeLabel: z.string().trim().min(1).max(100).default('Member'),
  firstName: z.string().trim().min(1).max(120),
  middleName: optionalText(120),
  lastName: optionalText(120),
  preferredName: optionalText(120),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()).nullable().optional(),
  phone: optionalText(40),
  branchId: uuid.nullable().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'ARCHIVED']).optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const updateTenantPersonSchema = createTenantPersonSchema.omit({ personNumber: true }).partial()
  .refine((value) => Object.keys(value).length > 0, 'Change at least one person field.');

export const bulkCreateTenantPeopleSchema = z.object({
  people: z.array(createTenantPersonSchema).min(1).max(100),
}).superRefine(({ people }, context) => {
  const numbers = new Set<string>();
  people.forEach((person, index) => {
    if (!person.personNumber) return;
    const number = person.personNumber.toLowerCase();
    if (numbers.has(number)) context.addIssue({ code: 'custom', path: ['people', index, 'personNumber'], message: 'Person numbers must be unique in the import.' });
    numbers.add(number);
  });
});

export const createTenantPersonGroupSchema = z.object({
  name: z.string().trim().min(1).max(120),
  code: z.string().trim().min(1).max(48).regex(/^[A-Za-z0-9_-]+$/).transform((value) => value.toUpperCase()),
  description: optionalText(500),
  typeKey: personType.nullable().optional(),
  active: z.boolean().optional(),
});

export const updateTenantPersonGroupSchema = createTenantPersonGroupSchema.partial()
  .refine((value) => Object.keys(value).length > 0, 'Change at least one group field.');

export const replaceTenantPersonGroupMembersSchema = z.object({
  personIds: z.array(uuid).max(2000).refine((ids) => new Set(ids).size === ids.length, 'A person can be included only once.'),
  startedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export type CreateTenantPersonInput = z.infer<typeof createTenantPersonSchema>;
export type UpdateTenantPersonInput = z.infer<typeof updateTenantPersonSchema>;
export type BulkCreateTenantPeopleInput = z.infer<typeof bulkCreateTenantPeopleSchema>;
export type CreateTenantPersonGroupInput = z.infer<typeof createTenantPersonGroupSchema>;
export type UpdateTenantPersonGroupInput = z.infer<typeof updateTenantPersonGroupSchema>;
export type ReplaceTenantPersonGroupMembersInput = z.infer<typeof replaceTenantPersonGroupMembersSchema>;

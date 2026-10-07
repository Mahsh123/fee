import { z } from 'zod';

const uuid = z.string().uuid();
const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();

export const createBranchSchema = z.object({
  code: z.string().trim().min(1).max(48).regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().trim().min(1).max(160),
  phone: nullableText(32),
  email: z.union([z.string().trim().email().max(254), z.literal(''), z.null()]).optional(),
  address: z.record(z.string(), z.unknown()).nullable().optional(),
  capacity: z.number().int().positive().nullable().optional(),
  managerId: uuid.nullable().optional(),
  enabledModules: z.array(z.string().trim().min(1).max(80)).max(100).optional(),
});

export const updateBranchSchema = createBranchSchema.partial().extend({
  status: z.enum(['ACTIVE', 'INACTIVE', 'ARCHIVED']).optional(),
}).refine((value) => Object.keys(value).length > 0, 'Change at least one branch field.');

export const replaceBranchMembersSchema = z.object({ userIds: z.array(uuid).max(2000).refine((ids) => new Set(ids).size === ids.length, 'A user can be assigned to a branch only once.') });
export const replaceUserBranchesSchema = z.object({
  branchIds: z.array(uuid).min(1).max(500).refine((ids) => new Set(ids).size === ids.length, 'A branch can be assigned only once.'),
  primaryBranchId: uuid,
}).refine((value) => value.branchIds.includes(value.primaryBranchId), 'The primary branch must be in the assigned branch list.');

export const createOrganizationUnitSchema = z.object({
  code: z.string().trim().min(1).max(48).regex(/^[A-Za-z0-9_-]+$/),
  name: z.string().trim().min(1).max(160),
  unitType: z.string().trim().min(1).max(80),
  description: nullableText(1000),
  parentId: uuid.nullable().optional(),
});

export const updateOrganizationUnitSchema = createOrganizationUnitSchema.partial().extend({ active: z.boolean().optional() })
  .refine((value) => Object.keys(value).length > 0, 'Change at least one organization unit field.');
export const replaceOrganizationMembersSchema = z.object({ userIds: z.array(uuid).max(2000).refine((ids) => new Set(ids).size === ids.length, 'A user can belong to a unit only once.') });

export const createUserAssignmentSchema = z.object({
  userId: uuid,
  branchId: uuid.nullable().optional(),
  resourceType: z.string().trim().min(1).max(80),
  resourceId: z.string().trim().min(1).max(200),
  resourceLabel: nullableText(200),
  dueAt: z.string().datetime().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const updateUserAssignmentSchema = z.object({
  status: z.enum(['ASSIGNED', 'STARTED', 'IN_PROGRESS', 'COMPLETED', 'OVERDUE', 'CANCELLED']).optional(),
  dueAt: z.string().datetime().nullable().optional(),
  startedAt: z.string().datetime().nullable().optional(),
  completedAt: z.string().datetime().nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, 'Change at least one assignment field.');

export type CreateBranchInput = z.infer<typeof createBranchSchema>;
export type UpdateBranchInput = z.infer<typeof updateBranchSchema>;
export type ReplaceBranchMembersInput = z.infer<typeof replaceBranchMembersSchema>;
export type ReplaceUserBranchesInput = z.infer<typeof replaceUserBranchesSchema>;
export type CreateOrganizationUnitInput = z.infer<typeof createOrganizationUnitSchema>;
export type UpdateOrganizationUnitInput = z.infer<typeof updateOrganizationUnitSchema>;
export type ReplaceOrganizationMembersInput = z.infer<typeof replaceOrganizationMembersSchema>;
export type CreateUserAssignmentInput = z.infer<typeof createUserAssignmentSchema>;
export type UpdateUserAssignmentInput = z.infer<typeof updateUserAssignmentSchema>;

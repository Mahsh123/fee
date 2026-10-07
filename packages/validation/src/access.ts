import { z } from 'zod';

const uuid = z.string().uuid();

export const createTenantUserSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  phone: z.string().trim().max(32).nullable().optional(),
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().max(120).nullable().optional(),
  temporaryPassword: z.string().min(12, 'Use a temporary password with at least 12 characters.').max(200),
  roleIds: z.array(uuid).min(1).max(100),
  studentId: uuid.nullable().optional(),
  guardianId: uuid.nullable().optional(),
});
export const inviteTenantUserSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  phone: z.string().trim().max(32).nullable().optional(),
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().max(120).nullable().optional(),
  roleIds: z.array(uuid).min(1).max(100),
  studentId: uuid.nullable().optional(),
  guardianId: uuid.nullable().optional(),
});
export const acceptInvitationSchema = z.object({
  token: z.string().min(32).max(200),
  password: z.string().min(12, 'Choose a password of at least 12 characters.').max(200),
});
export const publicTenantRegistrationSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().max(120).nullable().optional(),
});
export const changeOwnEmailSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  currentPassword: z.string().min(1).max(200),
});
export const acceptEmailChangeSchema = z.object({ token: z.string().min(32).max(200) });

export const assignUserRolesSchema = z.object({ roleIds: z.array(uuid).min(1).max(100) });
export const updateTenantUserStatusSchema = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED', 'DISABLED']) });
export const updateTenantUserProfileSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()).optional(),
  phone: z.string().trim().max(32).nullable().optional(),
  firstName: z.string().trim().min(1).max(120).optional(),
  lastName: z.string().trim().max(120).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, 'Change at least one user field.');
export const updateOwnProfileSchema = z.object({
  phone: z.string().trim().max(32).nullable().optional(),
  firstName: z.string().trim().min(1).max(120).optional(),
  lastName: z.string().trim().max(120).nullable().optional(),
}).refine((value) => Object.keys(value).length > 0, 'Change at least one profile field.');
export const resetTenantUserPasswordSchema = z.object({ temporaryPassword: z.string().min(12).max(200) });
export const updateRolePermissionsSchema = z.object({ permissionKeys: z.array(z.string().trim().min(1).max(100)).max(500) });
export const createTenantRoleSchema = z.object({
  key: z.string().trim().toUpperCase().min(2).max(80).regex(/^[A-Z][A-Z0-9_]*$/),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).nullable().optional(),
  permissionKeys: z.array(z.string().trim().min(1).max(100)).max(500).default([]),
});
export const updateTenantRoleSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  active: z.boolean().optional(),
}).refine((value) => Object.keys(value).length > 0, 'Change at least one role field.');

export type CreateTenantUserInput = z.infer<typeof createTenantUserSchema>;
export type InviteTenantUserInput = z.infer<typeof inviteTenantUserSchema>;
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;
export type PublicTenantRegistrationInput = z.infer<typeof publicTenantRegistrationSchema>;
export type ChangeOwnEmailInput = z.infer<typeof changeOwnEmailSchema>;
export type AcceptEmailChangeInput = z.infer<typeof acceptEmailChangeSchema>;
export type AssignUserRolesInput = z.infer<typeof assignUserRolesSchema>;
export type UpdateTenantUserStatusInput = z.infer<typeof updateTenantUserStatusSchema>;
export type UpdateTenantUserProfileInput = z.infer<typeof updateTenantUserProfileSchema>;
export type UpdateOwnProfileInput = z.infer<typeof updateOwnProfileSchema>;
export type UpdateRolePermissionsInput = z.infer<typeof updateRolePermissionsSchema>;
export type CreateTenantRoleInput = z.infer<typeof createTenantRoleSchema>;
export type UpdateTenantRoleInput = z.infer<typeof updateTenantRoleSchema>;

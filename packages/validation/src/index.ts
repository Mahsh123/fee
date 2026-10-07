import { z } from 'zod';

/** Shared request/form schemas. These contracts validate input without owning transport behavior. */
export const loginSchema = z.object({
  email: z.string().email('A valid email address is required.'),
  password: z.string().min(1, 'The password is required.').max(200),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(10, 'A refresh token is required.').optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12, 'Choose a password of at least 12 characters.').max(200),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RefreshInput = z.infer<typeof refreshSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export * from './students';
export * from './fees';
export * from './payments';
export * from './gateways';
export * from './settings';
export * from './access';
export * from './academics';
export * from './organization';
export * from './tenant-operations';
export * from './platform';
export * from './sponsors';
export * from './adjustments';
export * from './benefits';
export * from './payer-responsibilities';

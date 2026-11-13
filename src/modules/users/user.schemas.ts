import { Role } from '@prisma/client';
import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/http/pagination.js';
import { passwordSchema } from './password-policy.js';

const name = z.string().trim().min(1).max(120);

export const userIdParamsSchema = z.object({ id: z.uuid() });

export const userListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().min(1).max(120).optional(),
  role: z.enum(Role).optional(),
  active: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export const createUserSchema = z.strictObject({
  // Trimmed and lowercased: the same normalization as the login.
  email: z
    .string()
    .trim()
    .max(254)
    .pipe(z.email())
    .transform((value) => value.toLowerCase()),
  name,
  role: z.enum(Role),
  temporaryPassword: passwordSchema,
});

// No email (it identifies the account) and no password (reset-password does that).
export const updateUserSchema = z
  .strictObject({
    name: name.optional(),
    role: z.enum(Role).optional(),
    active: z.boolean().optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: 'at least one field is required',
  });

export const resetPasswordSchema = z.strictObject({ temporaryPassword: passwordSchema });

export type UserListQuery = z.infer<typeof userListQuerySchema>;
export type CreateUserBody = z.infer<typeof createUserSchema>;
export type UpdateUserBody = z.infer<typeof updateUserSchema>;
export type ResetPasswordBody = z.infer<typeof resetPasswordSchema>;

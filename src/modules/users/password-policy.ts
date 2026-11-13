import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 10;
/** bcrypt only uses the first 72 bytes: a longer password would be silently truncated. */
export const PASSWORD_MAX_LENGTH = 72;

/**
 * Passwords set from the app (temporary ones by an ADMIN and the user's own):
 * at least 10 characters with letters and numbers. Seed accounts keep their
 * own policy (src/seed).
 */
export const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH)
  .max(PASSWORD_MAX_LENGTH)
  .refine((value) => /\p{L}/u.test(value), { message: 'must contain a letter' })
  .refine((value) => /\p{Nd}/u.test(value), { message: 'must contain a number' });

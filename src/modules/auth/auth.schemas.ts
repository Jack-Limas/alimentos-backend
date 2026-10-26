import { z } from 'zod';

export const loginBodySchema = z.object({
  // Trimmed before validation; the service also lowercases it.
  email: z.string().trim().max(254).pipe(z.email()),
  // Upper bound avoids hashing huge payloads; bcrypt only uses the first 72 bytes anyway.
  password: z.string().min(1).max(200),
});

export type LoginBody = z.infer<typeof loginBodySchema>;

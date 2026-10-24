import dotenv from 'dotenv';
import { z } from 'zod';

const optionalString = z.string().trim().min(1).optional();

const corsOrigins = z
  .string()
  .trim()
  .min(1)
  .transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  )
  .pipe(z.array(z.url()).min(1));

export const envSchema = z.object({
  // Required since phase 0
  NODE_ENV: z.enum(['development', 'test', 'production']),
  DATABASE_URL: z.url(),
  DIRECT_URL: z.url(),
  CORS_ORIGINS: corsOrigins,
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),

  // Authentication (required from the auth phase)
  JWT_ACCESS_SECRET: optionalString,
  JWT_REFRESH_SECRET: optionalString,
  ACCESS_TOKEN_TTL: optionalString,
  REFRESH_TOKEN_TTL: optionalString,

  // Signed dispatch sheet links [EXTRA]
  SHEET_LINK_SECRET: optionalString,

  // AI service
  AI_SERVICE_URL: z.url().optional(),
  AI_INTERNAL_KEY: optionalString,
  AI_TIMEOUT_MS: z.coerce.number().int().positive().optional(),

  // Product photos [EXTRA]
  CLOUDINARY_URL: optionalString,

  // Seed
  SEED_ADMIN_PASSWORD: optionalString,
  SEED_OPERATOR_PASSWORD: optionalString,
  SEED_SIZE: z.enum(['small', 'large']).optional(),
});

export type Env = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(public readonly issues: string[]) {
    super(
      `Invalid environment configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`,
    );
    this.name = 'EnvValidationError';
  }
}

/**
 * Parses and validates the given environment. Never includes values in the
 * error message, only variable names, so secrets are not leaked to logs.
 */
export function parseEnv(rawSource: NodeJS.ProcessEnv): Env {
  // Empty values (e.g. `PORT=` copied from .env.example) are treated as unset.
  const source = Object.fromEntries(
    Object.entries(rawSource).filter(([, value]) => value !== undefined && value.trim() !== ''),
  );
  const result = envSchema.safeParse(source);
  if (result.success) {
    return result.data;
  }

  const issues = result.error.issues.map((issue) => {
    const name = issue.path.join('.') || '(root)';
    const isMissing = issue.code === 'invalid_type' && source[name] === undefined;
    return isMissing ? `${name}: missing required variable` : `${name}: ${issue.message}`;
  });
  throw new EnvValidationError(issues);
}

/**
 * Loads `.env` (if present) and validates it. Aborts the process with a clear
 * message when the configuration is invalid.
 */
export function loadEnv(): Env {
  dotenv.config({ quiet: true });
  try {
    return parseEnv(process.env);
  } catch (error) {
    if (error instanceof EnvValidationError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

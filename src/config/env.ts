import dotenv from 'dotenv';
import { z } from 'zod';

const optionalString = z.string().trim().min(1).optional();

/** True when Intl knows the IANA time zone (e.g. America/Bogota). */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

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

/**
 * TRUST_PROXY: "true" trusts every proxy in X-Forwarded-For (Render's default
 * setup); a number trusts that many hops, the safer setting once the real
 * chain is known (see GET /admin/network-info and docs/deployment.md).
 */
const trustProxy = z
  .string()
  .trim()
  .regex(/^(true|[1-9]\d?)$/, 'must be "true" or a number of proxy hops (1-99)')
  .default('true')
  .transform((value) => (value === 'true' ? true : Number(value)));

export const envSchema = z.object({
  // Required since phase 0
  NODE_ENV: z.enum(['development', 'test', 'production']),
  DATABASE_URL: z.url(),
  DIRECT_URL: z.url(),
  CORS_ORIGINS: corsOrigins,
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  TRUST_PROXY: trustProxy,

  // Authentication. Refresh tokens are opaque (hashed in the DB), so they need no secret.
  JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters long'),
  ACCESS_TOKEN_TTL: z
    .string()
    .trim()
    .regex(/^\d+[smhd]$/, 'must be a duration such as 15m, 1h or 30s')
    .default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(5),
  LOGIN_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),

  // Business calendar: "today" and days to expiry are computed in this IANA time zone.
  APP_TIMEZONE: z
    .string()
    .trim()
    .refine(isValidTimeZone, 'must be an IANA time zone such as America/Bogota')
    .default('America/Bogota'),

  // Signed dispatch sheet links [EXTRA]
  SHEET_LINK_SECRET: optionalString,

  // AI service
  AI_SERVICE_URL: z.url().optional(),
  AI_INTERNAL_KEY: optionalString,
  AI_TIMEOUT_MS: z.coerce.number().int().positive().optional(),

  // Worker threads for reports and the benchmark (optional)
  WORKER_POOL_SIZE: z.coerce.number().int().min(1).max(8).default(2),
  WORKER_TASK_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
  // Largest benchmark size: its main-thread run blocks the server for everyone (8000 on a free plan).
  BENCHMARK_MAX_SIZE: z.coerce.number().int().min(1_000).max(30_000).default(30_000),

  // Product photos [EXTRA]
  CLOUDINARY_URL: optionalString,

  // SEED_* variables are validated only by the seed script (prisma/seed.ts).
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

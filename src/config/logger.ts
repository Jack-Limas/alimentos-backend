import type { FastifyServerOptions } from 'fastify';
import type { Env } from './env.js';

/** Field names that hold credentials. Pino has no partial-key wildcards, so they are listed. */
const SENSITIVE_FIELDS = [
  'password',
  'token',
  'accessToken',
  'refreshToken',
  'refresh_token',
  'tokenHash',
];

/** Values that must never reach the logs: auth headers, cookies, passwords and tokens. */
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  'headers["set-cookie"]',
  'body.password',
  'req.body.password',
  ...SENSITIVE_FIELDS.flatMap((field) => [field, `*.${field}`, `*.*.${field}`]),
];

export function buildLoggerOptions(
  nodeEnv: Env['NODE_ENV'],
): NonNullable<FastifyServerOptions['logger']> {
  return {
    level: nodeEnv === 'production' ? 'info' : nodeEnv === 'test' ? 'silent' : 'debug',
    redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
  };
}

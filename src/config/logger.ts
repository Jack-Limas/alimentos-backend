import type { FastifyServerOptions } from 'fastify';
import type { Env } from './env.js';

/** Header values that must never reach the logs. */
export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'headers.authorization',
  'headers.cookie',
  'headers["set-cookie"]',
];

export function buildLoggerOptions(
  nodeEnv: Env['NODE_ENV'],
): NonNullable<FastifyServerOptions['logger']> {
  return {
    level: nodeEnv === 'production' ? 'info' : nodeEnv === 'test' ? 'silent' : 'debug',
    redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' },
  };
}

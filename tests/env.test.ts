import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseEnv } from '../src/config/env.js';

const validEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user@localhost:5432/app',
  DIRECT_URL: 'postgresql://user@localhost:5432/app',
  CORS_ORIGINS: 'http://localhost:3000',
  JWT_ACCESS_SECRET: 'test-access-secret-0123456789abcdef0123456789',
};

describe('parseEnv', () => {
  it('parses a valid environment and defaults PORT to 4000', () => {
    const env = parseEnv(validEnv);

    expect(env.PORT).toBe(4000);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000']);
  });

  it('splits and trims a comma-separated CORS_ORIGINS list', () => {
    const env = parseEnv({
      ...validEnv,
      CORS_ORIGINS: 'http://localhost:3000, https://app.vercel.app ,',
    });

    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000', 'https://app.vercel.app']);
  });

  it('names the missing variable when DATABASE_URL is absent', () => {
    const { DATABASE_URL: _omitted, ...withoutDb } = validEnv;

    expect(() => parseEnv(withoutDb)).toThrow(EnvValidationError);
    expect(() => parseEnv(withoutDb)).toThrow(/DATABASE_URL: missing required variable/);
  });

  it('treats empty values as unset', () => {
    const env = parseEnv({ ...validEnv, PORT: '', AI_INTERNAL_KEY: '' });

    expect(env.PORT).toBe(4000);
    expect(env.AI_INTERNAL_KEY).toBeUndefined();
  });

  it('applies the auth defaults', () => {
    const env = parseEnv(validEnv);

    expect(env.ACCESS_TOKEN_TTL).toBe('15m');
    expect(env.REFRESH_TOKEN_TTL_DAYS).toBe(7);
    expect(env.LOGIN_MAX_ATTEMPTS).toBe(5);
    expect(env.LOGIN_WINDOW_MINUTES).toBe(15);
  });

  it('requires JWT_ACCESS_SECRET with at least 32 characters', () => {
    const { JWT_ACCESS_SECRET: _omitted, ...withoutSecret } = validEnv;

    expect(() => parseEnv(withoutSecret)).toThrow(/JWT_ACCESS_SECRET: missing required variable/);
    expect(() => parseEnv({ ...validEnv, JWT_ACCESS_SECRET: 'short' })).toThrow(/at least 32/);
  });

  it('rejects an invalid ACCESS_TOKEN_TTL', () => {
    expect(() => parseEnv({ ...validEnv, ACCESS_TOKEN_TTL: 'forever' })).toThrow(
      /ACCESS_TOKEN_TTL/,
    );
  });

  it('defaults APP_TIMEZONE to America/Bogota and accepts other IANA zones', () => {
    expect(parseEnv(validEnv).APP_TIMEZONE).toBe('America/Bogota');
    expect(parseEnv({ ...validEnv, APP_TIMEZONE: 'Europe/Madrid' }).APP_TIMEZONE).toBe(
      'Europe/Madrid',
    );
  });

  it('rejects an unknown APP_TIMEZONE', () => {
    expect(() => parseEnv({ ...validEnv, APP_TIMEZONE: 'Mars/Olympus' })).toThrow(
      /APP_TIMEZONE: must be an IANA time zone/,
    );
  });

  it('defaults TRUST_PROXY to true and accepts a number of hops', () => {
    expect(parseEnv(validEnv).TRUST_PROXY).toBe(true);
    expect(parseEnv({ ...validEnv, TRUST_PROXY: 'true' }).TRUST_PROXY).toBe(true);
    expect(parseEnv({ ...validEnv, TRUST_PROXY: '2' }).TRUST_PROXY).toBe(2);
    expect(() => parseEnv({ ...validEnv, TRUST_PROXY: 'false' })).toThrow(/TRUST_PROXY/);
    expect(() => parseEnv({ ...validEnv, TRUST_PROXY: '0' })).toThrow(/TRUST_PROXY/);
    expect(() => parseEnv({ ...validEnv, TRUST_PROXY: '10.0.0.1' })).toThrow(/TRUST_PROXY/);
  });

  it('defaults BENCHMARK_MAX_SIZE to 30000 and keeps it between 1000 and 30000', () => {
    expect(parseEnv(validEnv).BENCHMARK_MAX_SIZE).toBe(30_000);
    expect(parseEnv({ ...validEnv, BENCHMARK_MAX_SIZE: '8000' }).BENCHMARK_MAX_SIZE).toBe(8_000);
    expect(() => parseEnv({ ...validEnv, BENCHMARK_MAX_SIZE: '50000' })).toThrow(
      /BENCHMARK_MAX_SIZE/,
    );
    expect(() => parseEnv({ ...validEnv, BENCHMARK_MAX_SIZE: '500' })).toThrow(
      /BENCHMARK_MAX_SIZE/,
    );
  });

  it('never includes variable values in the error message', () => {
    const secret = 'not-a-url-but-a-secret';

    expect(() => parseEnv({ ...validEnv, DIRECT_URL: secret })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(secret) as unknown }),
    );
  });
});

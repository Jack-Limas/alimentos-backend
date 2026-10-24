import { describe, expect, it } from 'vitest';
import { EnvValidationError, parseEnv } from '../src/config/env.js';

const validEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://user@localhost:5432/app',
  DIRECT_URL: 'postgresql://user@localhost:5432/app',
  CORS_ORIGINS: 'http://localhost:3000',
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
    const env = parseEnv({ ...validEnv, PORT: '', JWT_ACCESS_SECRET: '' });

    expect(env.PORT).toBe(4000);
    expect(env.JWT_ACCESS_SECRET).toBeUndefined();
  });

  it('never includes variable values in the error message', () => {
    const secret = 'not-a-url-but-a-secret';

    expect(() => parseEnv({ ...validEnv, DIRECT_URL: secret })).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining(secret) as unknown }),
    );
  });
});

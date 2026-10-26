import { describe, expect, it } from 'vitest';
import { createBcryptHasher } from '../src/modules/auth/password-hasher.js';
import { generateRefreshToken, hashRefreshToken } from '../src/modules/auth/refresh-token.js';

describe('refresh token primitives', () => {
  it('generates unique base64url tokens of 48 random bytes', () => {
    const first = generateRefreshToken();
    const second = generateRefreshToken();

    expect(first).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(first).not.toBe(second);
  });

  it('hashes deterministically without returning the token', () => {
    const token = generateRefreshToken();

    expect(hashRefreshToken(token)).toBe(hashRefreshToken(token));
    expect(hashRefreshToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRefreshToken(token)).not.toContain(token);
  });
});

describe('bcrypt password hasher', () => {
  const hasher = createBcryptHasher(4);

  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await hasher.hash('Correct-Horse-1');

    await expect(hasher.compare('Correct-Horse-1', hash)).resolves.toBe(true);
    await expect(hasher.compare('wrong', hash)).resolves.toBe(false);
  });

  it('always returns false when comparing against the dummy hash', async () => {
    await expect(hasher.compareWithDummy('anything')).resolves.toBe(false);
  });

  it('uses cost 12 by default', async () => {
    const hash = await createBcryptHasher().hash('x');

    expect(hash.startsWith('$2b$12$')).toBe(true);
  });
});

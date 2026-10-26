import { describe, expect, it } from 'vitest';
import {
  ADMIN,
  buildAuthTestApp,
  login,
  refresh,
  refreshCookieValue,
  refreshSetCookie,
} from './helpers/auth-fixtures.js';

describe('POST /api/v1/auth/refresh', () => {
  it('returns 401 UNAUTHENTICATED without a cookie or with an unknown token', async () => {
    const { app } = await buildAuthTestApp();

    const missing = await app.inject({ method: 'POST', url: '/api/v1/auth/refresh' });
    const unknown = await refresh(app, 'not-a-real-token');

    for (const res of [missing, unknown]) {
      expect(res.statusCode).toBe(401);
      expect(res.json<{ error: { code: string } }>().error.code).toBe('UNAUTHENTICATED');
    }
    await app.close();
  });

  it('rotates: returns a new access token and cookie, and the old token stops working', async () => {
    const { app } = await buildAuthTestApp();
    const original = refreshCookieValue(await login(app, ADMIN));

    const rotated = await refresh(app, original);

    expect(rotated.statusCode).toBe(200);
    expect(Object.keys(rotated.json())).toEqual(['accessToken']);
    const next = refreshCookieValue(rotated);
    expect(next).not.toBe(original);
    expect(refreshSetCookie(rotated)).toMatch(/HttpOnly/i);
    expect(refreshSetCookie(rotated)).toMatch(/SameSite=None/i);

    const newOneWorks = await refresh(app, next);
    expect(newOneWorks.statusCode).toBe(200);
    await app.close();
  });

  it('detects reuse of a rotated token: revokes the whole family and audits it', async () => {
    const { app, repositories, admin } = await buildAuthTestApp();
    const original = refreshCookieValue(await login(app, ADMIN));
    const next = refreshCookieValue(await refresh(app, original));

    const reuse = await refresh(app, original);

    expect(reuse.statusCode).toBe(401);
    // The legitimate newer token was revoked along with the family.
    expect((await refresh(app, next)).statusCode).toBe(401);
    expect([...repositories.refreshTokens.tokens.values()].every((t) => t.revokedAt)).toBe(true);
    expect(repositories.auditLogs.entries).toContainEqual(
      expect.objectContaining({ action: 'TOKEN_REUSE_DETECTED', userId: admin.id }),
    );
    await app.close();
  });

  it('keeps the rotation chain in the same family with replacedById links', async () => {
    const { app, repositories } = await buildAuthTestApp();
    const original = refreshCookieValue(await login(app, ADMIN));
    await refresh(app, original);

    const [first, second] = [...repositories.refreshTokens.tokens.values()];

    expect(second?.familyId).toBe(first?.familyId);
    expect(first?.replacedById).toBe(second?.id);
    expect(first?.revokedAt).not.toBeNull();
    expect(second?.revokedAt).toBeNull();
    // Only hashes are stored.
    expect(first?.tokenHash).not.toBe(original);
    await app.close();
  });

  it('rejects an expired refresh token', async () => {
    let now = new Date('2026-10-26T12:00:00Z');
    const { app } = await buildAuthTestApp({ clock: () => now });
    const token = refreshCookieValue(await login(app, ADMIN));

    now = new Date('2026-11-02T12:00:01Z');

    expect((await refresh(app, token)).statusCode).toBe(401);
    await app.close();
  });

  it('revokes the family when the user is no longer active', async () => {
    const { app, repositories, admin } = await buildAuthTestApp();
    const token = refreshCookieValue(await login(app, ADMIN));
    repositories.users.users.set(admin.id, { ...admin, active: false });

    const res = await refresh(app, token);

    expect(res.statusCode).toBe(401);
    expect([...repositories.refreshTokens.tokens.values()].every((t) => t.revokedAt)).toBe(true);
    await app.close();
  });
});

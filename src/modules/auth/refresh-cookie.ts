import type { CookieSerializeOptions } from '@fastify/cookie';

export const REFRESH_COOKIE_NAME = 'refresh_token';
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

/**
 * Frontend (*.vercel.app) and API (*.onrender.com) are different sites, so the
 * cookie must be SameSite=None, which browsers only accept together with Secure.
 * Logout clears it with these same attributes.
 */
export function refreshCookieOptions(maxAgeSeconds: number): CookieSerializeOptions {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'none',
    path: REFRESH_COOKIE_PATH,
    maxAge: maxAgeSeconds,
  };
}

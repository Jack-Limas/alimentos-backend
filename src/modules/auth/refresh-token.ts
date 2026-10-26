import { createHash, randomBytes } from 'node:crypto';

const REFRESH_TOKEN_BYTES = 48;

/** Opaque refresh token sent to the client in an HttpOnly cookie. */
export function generateRefreshToken(): string {
  return randomBytes(REFRESH_TOKEN_BYTES).toString('base64url');
}

/** Only this SHA-256 digest is stored; a DB leak does not expose usable tokens. */
export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

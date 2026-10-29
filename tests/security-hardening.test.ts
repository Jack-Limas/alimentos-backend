import { describe, expect, it } from 'vitest';
import { BODY_LIMIT_BYTES, trustProxyOption } from '../src/app.js';
import { ALLOWED_ORIGIN, buildTestApp } from './helpers/test-app.js';

describe('hardening', () => {
  it('rejects bodies over 1 MiB with 413 PAYLOAD_TOO_LARGE in the contract format', async () => {
    const app = await buildTestApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ email: 'a@b.co', password: 'x'.repeat(BODY_LIMIT_BYTES) }),
    });

    expect(BODY_LIMIT_BYTES).toBe(1_048_576);
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ error: { code: 'PAYLOAD_TOO_LARGE' } });
    expect(res.body).not.toContain('stack');
    await app.close();
  });

  it('sends the security headers and hides the server technology', async () => {
    const app = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toMatch(/max-age=\d+/);
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    // The frontend is cross-origin isolated (COEP): the API must allow cross-origin reads.
    expect(res.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(res.headers['x-powered-by']).toBeUndefined();
    await app.close();
  });

  it('allows only the exact configured origins', async () => {
    const app = await buildTestApp();
    for (const origin of [
      `${ALLOWED_ORIGIN}.evil.example`,
      'http://localhost:3001',
      'https://localhost:3000',
      'null',
    ]) {
      const res = await app.inject({
        method: 'OPTIONS',
        url: '/api/v1/products',
        headers: { origin, 'access-control-request-method': 'GET' },
      });
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    }
    const allowed = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/products',
      headers: {
        origin: ALLOWED_ORIGIN,
        'access-control-request-method': 'PATCH',
        'access-control-request-headers': 'authorization,content-type',
      },
    });
    expect(allowed.statusCode).toBe(204);
    expect(allowed.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');
    expect(String(allowed.headers['access-control-allow-methods'])).toContain('PATCH');
    await app.close();
  });

  it('trusts every proxy with TRUST_PROXY=true and only N hops with a number', () => {
    expect(trustProxyOption(true)).toBe(true);
    const oneHop = trustProxyOption(1);
    expect(typeof oneHop).toBe('function');
    if (typeof oneHop === 'function') {
      expect(oneHop('10.0.0.1', 0)).toBe(true);
      expect(oneHop('10.0.0.2', 1)).toBe(false);
    }
  });
});

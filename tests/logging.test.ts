import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { REDACTED_PATHS } from '../src/config/logger.js';
import { ADMIN, buildAuthTestApp, login, refreshCookieValue } from './helpers/auth-fixtures.js';

function captureLogs() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(chunk.toString('utf8'));
      callback();
    },
  });
  return { lines, stream };
}

describe('request logging', () => {
  it('never writes the password, the refresh token or the access token', async () => {
    const { lines, stream } = captureLogs();
    const { app } = await buildAuthTestApp({
      logger: { level: 'trace', stream, redact: { paths: REDACTED_PATHS, censor: '[REDACTED]' } },
    });

    const res = await login(app, ADMIN);
    const { accessToken } = res.json<{ accessToken: string }>();
    const refreshToken = refreshCookieValue(res);
    // A careless log of the body or the session must still be censored.
    app.log.info({ body: { email: ADMIN.email, password: ADMIN.password } }, 'debug body');
    app.log.info({ session: { accessToken, refreshToken } }, 'debug session');
    await app.close();

    const output = lines.join('');
    expect(output.length).toBeGreaterThan(0);
    expect(output).toContain('[REDACTED]');
    expect(output).not.toContain(ADMIN.password);
    expect(output).not.toContain(refreshToken);
    expect(output).not.toContain(accessToken);
  });
});

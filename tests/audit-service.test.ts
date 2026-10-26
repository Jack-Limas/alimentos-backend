import { describe, expect, it } from 'vitest';
import { createAuditService, sanitizeMetadata } from '../src/modules/audit/audit.service.js';
import { createInMemoryAuditLogRepository } from './helpers/in-memory-repositories.js';

describe('sanitizeMetadata', () => {
  it('drops password, token, secret, cookie and authorization keys at any depth', () => {
    const result = sanitizeMetadata({
      email: 'a@b.co',
      password: 'p',
      nested: { refreshToken: 't', accessToken: 't', clientSecret: 's', keep: 1 },
      list: [{ cookie: 'c', authorization: 'Bearer x', ok: true }],
    });

    expect(result).toEqual({ email: 'a@b.co', nested: { keep: 1 }, list: [{ ok: true }] });
  });
});

describe('AuditService', () => {
  it('records sanitized entries and lists them newest first with pagination', async () => {
    const repository = createInMemoryAuditLogRepository();
    const service = createAuditService(repository);

    await service.record({ action: 'A', entity: 'User', metadata: { password: 'x', n: 1 } });
    await service.record({ action: 'B', entity: 'User', userId: 'u1', ip: '1.2.3.4' });

    const page = await service.list({}, { page: 1, pageSize: 1 });

    expect(page.meta).toEqual({ page: 1, pageSize: 1, total: 2 });
    expect(page.data[0]).toMatchObject({ action: 'B', userId: 'u1', ip: '1.2.3.4' });
    expect(repository.entries[0]?.metadata).toEqual({ n: 1 });
  });
});

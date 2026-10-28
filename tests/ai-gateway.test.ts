import { describe, expect, it } from 'vitest';
import { createAuditService } from '../src/modules/audit/index.js';
import type { AiClient } from '../src/modules/ai/ai-client.js';
import { AiError } from '../src/modules/ai/ai-error.js';
import { createAiGateway } from '../src/modules/ai/ai-gateway.js';
import { createInMemoryAuditLogRepository } from './helpers/in-memory-repositories.js';

const actor = { userId: '00000000-0000-4000-8000-000000000001', ip: '127.0.0.1' };
const meta = { model: 'gemini-test', latencyMs: 300 };
const input = {
  locale: 'es' as const,
  role: 'ADMIN' as const,
  alerts: [],
  pendingOrders: [],
  kpis: {},
};

function setup(briefing: AiClient['briefing']) {
  const auditLogs = createInMemoryAuditLogRepository();
  let clock = 0;
  const client: AiClient = {
    configured: true,
    briefing: (value) => {
      clock += 250;
      return briefing(value);
    },
    explainProposal: () => Promise.reject(new AiError('UPSTREAM_ERROR')),
    rescuePlan: () => Promise.reject(new AiError('UPSTREAM_ERROR')),
  };
  const gateway = createAiGateway({
    client,
    audit: createAuditService(auditLogs),
    now: () => clock,
  });
  return { gateway, auditLogs };
}

describe('createAiGateway', () => {
  it('records AI_REQUESTED with endpoint, category and latency, never the content', async () => {
    const { gateway, auditLogs } = setup(() =>
      Promise.resolve({ data: { summary: 'Texto privado', topActions: ['Acción'] }, meta }),
    );

    const result = await gateway.briefing(input, actor);

    expect(result.latencyMs).toBe(250);
    expect(auditLogs.entries).toHaveLength(1);
    expect(auditLogs.entries[0]).toMatchObject({
      action: 'AI_REQUESTED',
      entity: 'AI',
      userId: actor.userId,
      metadata: { endpoint: 'briefing', category: 'OK', latencyMs: 250, model: 'gemini-test' },
    });
    expect(JSON.stringify(auditLogs.entries[0]?.metadata)).not.toMatch(/Texto privado|Acción/);
  });

  it('records the failure category and rethrows the AI error', async () => {
    const { gateway, auditLogs } = setup(() => Promise.reject(new AiError('TIMEOUT')));

    await expect(gateway.briefing(input, actor)).rejects.toMatchObject({ category: 'TIMEOUT' });
    expect(auditLogs.entries[0]?.metadata).toEqual({
      endpoint: 'briefing',
      category: 'TIMEOUT',
      latencyMs: 250,
    });
  });
});

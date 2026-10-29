import type { FastifyRequest } from 'fastify';
import { AUDIT_ACTIONS, type AuditService } from '../audit/index.js';
import { actorOf } from '../../shared/http/actor.js';

/**
 * What the server sees of the client's address, to set TRUST_PROXY to the
 * real number of proxy hops on Render (docs/deployment.md):
 * - `ip`: the address Fastify trusts (used by the login and /public rate limits).
 * - `ips`: the X-Forwarded-For chain as trusted, closest proxy last.
 * - `forwardedFor`: the raw header, to count the hops that are really there.
 */
export interface NetworkInfo {
  ip: string;
  ips: string[];
  forwardedFor: string | null;
  remoteAddress: string | null;
  trustProxy: boolean | number;
}

export function readNetworkInfo(
  request: FastifyRequest,
  trustProxy: boolean | number,
): NetworkInfo {
  const header = request.headers['x-forwarded-for'];
  return {
    ip: request.ip,
    ips: request.ips ?? [request.ip],
    forwardedFor: Array.isArray(header) ? header.join(', ') : (header ?? null),
    remoteAddress: request.socket.remoteAddress ?? null,
    trustProxy,
  };
}

export interface AdminController {
  networkInfo: (request: FastifyRequest) => Promise<{ data: NetworkInfo }>;
}

export function createAdminController({
  audit,
  trustProxy,
}: {
  audit: AuditService;
  trustProxy: boolean | number;
}): AdminController {
  return {
    networkInfo: async (request) => {
      const actor = actorOf(request);
      const data = readNetworkInfo(request, trustProxy);
      // Only the shape is audited; the addresses are already in the row's ip column.
      await audit.record({
        userId: actor.userId,
        action: AUDIT_ACTIONS.NETWORK_INFO_VIEWED,
        entity: 'Network',
        entityId: null,
        metadata: { forwardedHops: data.forwardedFor?.split(',').length ?? 0, trustProxy },
        ip: actor.ip,
      });
      return { data };
    },
  };
}

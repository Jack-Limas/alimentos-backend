import type { FastifyReply, FastifyRequest } from 'fastify';
import { actorOf } from '../../shared/http/actor.js';
import type { Paginated } from '../../shared/http/pagination.js';
import type { ProposalDetailDto, ProposalDto } from './distribution.dto.js';
import {
  createProposalSchema,
  proposalIdParamsSchema,
  proposalListQuerySchema,
} from './distribution.schemas.js';
import type { DistributionService, SnapshotDto } from './distribution.service.js';

export interface DistributionController {
  snapshot: () => Promise<{ data: SnapshotDto }>;
  createProposal: (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => Promise<{ data: ProposalDetailDto }>;
  list: (request: FastifyRequest) => Promise<Paginated<ProposalDto>>;
  get: (request: FastifyRequest) => Promise<{ data: ProposalDetailDto }>;
  confirm: (request: FastifyRequest) => Promise<{ data: ProposalDetailDto }>;
  discard: (request: FastifyRequest) => Promise<{ data: ProposalDetailDto }>;
}

export function createDistributionController(service: DistributionService): DistributionController {
  const idOf = (request: FastifyRequest) => proposalIdParamsSchema.parse(request.params).id;

  return {
    snapshot: async () => ({ data: await service.snapshot() }),

    createProposal: async (request, reply) => {
      const body = createProposalSchema.parse(request.body);
      // `authorize` already checked the claims, so the role is ADMIN or OPERATOR.
      const actor = { ...actorOf(request), role: request.user.role };
      const data = await service.createProposal(body, actor);
      reply.status(201);
      return { data };
    },

    list: (request) => service.list(proposalListQuerySchema.parse(request.query)),

    get: async (request) => ({ data: await service.get(idOf(request)) }),

    confirm: async (request) => ({ data: await service.confirm(idOf(request), actorOf(request)) }),

    discard: async (request) => ({ data: await service.discard(idOf(request), actorOf(request)) }),
  };
}

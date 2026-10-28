import type { FastifyReply, FastifyRequest } from 'fastify';
import { actorOf } from '../../shared/http/actor.js';
import type { Paginated } from '../../shared/http/pagination.js';
import type { LotDto, MovementListDto } from './inventory.dto.js';
import {
  entryBodySchema,
  exitBodySchema,
  lotListQuerySchema,
  movementListQuerySchema,
} from './inventory.schemas.js';
import type {
  EntryResult,
  ExitResult,
  InventoryService,
  InventorySummary,
} from './inventory.service.js';

export interface InventoryController {
  listLots: (request: FastifyRequest) => Promise<Paginated<LotDto>>;
  listMovements: (request: FastifyRequest) => Promise<Paginated<MovementListDto>>;
  summary: () => Promise<{ data: InventorySummary }>;
  createEntry: (request: FastifyRequest, reply: FastifyReply) => Promise<{ data: EntryResult }>;
  createExit: (request: FastifyRequest, reply: FastifyReply) => Promise<{ data: ExitResult }>;
}

export function createInventoryController(service: InventoryService): InventoryController {
  return {
    listLots: (request) => service.listLots(lotListQuerySchema.parse(request.query)),

    listMovements: (request) => service.listMovements(movementListQuerySchema.parse(request.query)),

    summary: async () => ({ data: await service.summary() }),

    createEntry: async (request, reply) => {
      const body = entryBodySchema.parse(request.body);
      const data = await service.createEntry(body, actorOf(request));
      reply.status(201);
      return { data };
    },

    createExit: async (request, reply) => {
      const body = exitBodySchema.parse(request.body);
      const data = await service.createExit(body, actorOf(request));
      reply.status(201);
      return { data };
    },
  };
}

import type { FastifyReply, FastifyRequest } from 'fastify';
import { actorOf } from '../../shared/http/actor.js';
import type { Paginated } from '../../shared/http/pagination.js';
import type { OrderDetailDto, OrderDto } from './order.dto.js';
import {
  changeStatusSchema,
  createOrderSchema,
  orderIdParamsSchema,
  orderListQuerySchema,
} from './order.schemas.js';
import type { OrderService } from './order.service.js';

export interface OrderController {
  list: (request: FastifyRequest) => Promise<Paginated<OrderDto>>;
  get: (request: FastifyRequest) => Promise<{ data: OrderDetailDto }>;
  create: (request: FastifyRequest, reply: FastifyReply) => Promise<{ data: OrderDetailDto }>;
  changeStatus: (request: FastifyRequest) => Promise<{ data: OrderDetailDto }>;
}

export function createOrderController(service: OrderService): OrderController {
  return {
    list: (request) => service.list(orderListQuerySchema.parse(request.query)),

    get: async (request) => {
      const { id } = orderIdParamsSchema.parse(request.params);
      return { data: await service.get(id) };
    },

    create: async (request, reply) => {
      const body = createOrderSchema.parse(request.body);
      const data = await service.create(body, actorOf(request));
      reply.status(201);
      return { data };
    },

    changeStatus: async (request) => {
      const { id } = orderIdParamsSchema.parse(request.params);
      const body = changeStatusSchema.parse(request.body);
      // `authorize` already checked the claims, so the role is ADMIN or OPERATOR.
      const actor = { ...actorOf(request), role: request.user.role };
      return { data: await service.changeStatus(id, body, actor) };
    },
  };
}

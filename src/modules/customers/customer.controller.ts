import type { FastifyReply, FastifyRequest } from 'fastify';
import { actorOf } from '../../shared/http/actor.js';
import type { Paginated } from '../../shared/http/pagination.js';
import type { CustomerDto } from './customer.dto.js';
import {
  createCustomerSchema,
  customerIdParamsSchema,
  customerListQuerySchema,
  updateCustomerSchema,
} from './customer.schemas.js';
import type { CustomerService } from './customer.service.js';

export interface CustomerController {
  list: (request: FastifyRequest) => Promise<Paginated<CustomerDto>>;
  get: (request: FastifyRequest) => Promise<{ data: CustomerDto }>;
  create: (request: FastifyRequest, reply: FastifyReply) => Promise<{ data: CustomerDto }>;
  update: (request: FastifyRequest) => Promise<{ data: CustomerDto }>;
}

export function createCustomerController(service: CustomerService): CustomerController {
  return {
    list: (request) => service.list(customerListQuerySchema.parse(request.query)),

    get: async (request) => {
      const { id } = customerIdParamsSchema.parse(request.params);
      return { data: await service.get(id) };
    },

    create: async (request, reply) => {
      const body = createCustomerSchema.parse(request.body);
      const data = await service.create(body, actorOf(request));
      reply.status(201);
      return { data };
    },

    update: async (request) => {
      const { id } = customerIdParamsSchema.parse(request.params);
      const patch = updateCustomerSchema.parse(request.body);
      return { data: await service.update(id, patch, actorOf(request)) };
    },
  };
}

import type { FastifyReply, FastifyRequest } from 'fastify';
import { actorOf } from '../../shared/http/actor.js';
import type { Paginated } from '../../shared/http/pagination.js';
import type { ProductDetailDto, ProductDto } from './product.dto.js';
import {
  createProductSchema,
  productIdParamsSchema,
  productListQuerySchema,
  updateProductSchema,
} from './product.schemas.js';
import type { ProductService } from './product.service.js';

export interface ProductController {
  list: (request: FastifyRequest) => Promise<Paginated<ProductDto>>;
  get: (request: FastifyRequest) => Promise<{ data: ProductDetailDto }>;
  create: (request: FastifyRequest, reply: FastifyReply) => Promise<{ data: ProductDto }>;
  update: (request: FastifyRequest) => Promise<{ data: ProductDto }>;
}

export function createProductController(service: ProductService): ProductController {
  return {
    list: (request) => service.list(productListQuerySchema.parse(request.query)),

    get: async (request) => {
      const { id } = productIdParamsSchema.parse(request.params);
      return { data: await service.get(id) };
    },

    create: async (request, reply) => {
      const body = createProductSchema.parse(request.body);
      const data = await service.create(body, actorOf(request));
      reply.status(201);
      return { data };
    },

    update: async (request) => {
      const { id } = productIdParamsSchema.parse(request.params);
      const patch = updateProductSchema.parse(request.body);
      return { data: await service.update(id, patch, actorOf(request)) };
    },
  };
}

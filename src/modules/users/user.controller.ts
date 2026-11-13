import type { FastifyReply, FastifyRequest } from 'fastify';
import { actorOf } from '../../shared/http/actor.js';
import type { Paginated } from '../../shared/http/pagination.js';
import type { UserDto } from './user.dto.js';
import {
  createUserSchema,
  resetPasswordSchema,
  updateUserSchema,
  userIdParamsSchema,
  userListQuerySchema,
} from './user.schemas.js';
import type { UserService } from './user.service.js';

export interface UserController {
  list: (request: FastifyRequest) => Promise<Paginated<UserDto>>;
  create: (request: FastifyRequest, reply: FastifyReply) => Promise<{ data: UserDto }>;
  update: (request: FastifyRequest) => Promise<{ data: UserDto }>;
  resetPassword: (request: FastifyRequest) => Promise<{ data: UserDto }>;
}

export function createUserController(service: UserService): UserController {
  return {
    list: (request) => service.list(userListQuerySchema.parse(request.query)),

    create: async (request, reply) => {
      const body = createUserSchema.parse(request.body);
      const data = await service.create(body, actorOf(request));
      reply.status(201);
      return { data };
    },

    update: async (request) => {
      const { id } = userIdParamsSchema.parse(request.params);
      const patch = updateUserSchema.parse(request.body);
      return { data: await service.update(id, patch, actorOf(request)) };
    },

    resetPassword: async (request) => {
      const { id } = userIdParamsSchema.parse(request.params);
      const body = resetPasswordSchema.parse(request.body);
      return { data: await service.resetPassword(id, body, actorOf(request)) };
    },
  };
}

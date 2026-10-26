import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AuthService, PublicUser, RequestContext } from './auth.service.js';
import { loginBodySchema } from './auth.schemas.js';
import { REFRESH_COOKIE_NAME, refreshCookieOptions } from './refresh-cookie.js';

export interface AuthController {
  login: (
    request: FastifyRequest,
    reply: FastifyReply,
  ) => Promise<{ accessToken: string; user: PublicUser }>;
  refresh: (request: FastifyRequest, reply: FastifyReply) => Promise<{ accessToken: string }>;
  logout: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  me: (request: FastifyRequest) => Promise<{ data: PublicUser }>;
}

function context(request: FastifyRequest): RequestContext {
  const userAgent = request.headers['user-agent'];
  return {
    ip: request.ip,
    userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 512) : null,
  };
}

function secondsUntil(date: Date): number {
  return Math.max(0, Math.floor((date.getTime() - Date.now()) / 1000));
}

export function createAuthController(service: AuthService): AuthController {
  return {
    login: async (request, reply) => {
      const body = loginBodySchema.parse(request.body);
      const result = await service.login(body, context(request));
      reply.setCookie(
        REFRESH_COOKIE_NAME,
        result.refreshToken,
        refreshCookieOptions(secondsUntil(result.refreshExpiresAt)),
      );
      // The refresh token travels only in the HttpOnly cookie, never in the body.
      return { accessToken: result.accessToken, user: result.user };
    },

    refresh: async (request, reply) => {
      const result = await service.refresh(request.cookies[REFRESH_COOKIE_NAME], context(request));
      reply.setCookie(
        REFRESH_COOKIE_NAME,
        result.refreshToken,
        refreshCookieOptions(secondsUntil(result.refreshExpiresAt)),
      );
      return { accessToken: result.accessToken };
    },

    logout: async (request, reply) => {
      await service.logout(request.cookies[REFRESH_COOKIE_NAME], context(request));
      reply.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions(0));
      reply.status(204);
    },

    me: async (request) => ({ data: await service.me(request.user.sub) }),
  };
}

import cookie from '@fastify/cookie';
import jwt from '@fastify/jwt';
import type { Role } from '@prisma/client';
import type { FastifyPluginAsync, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../shared/errors/index.js';

export interface AccessTokenClaims {
  sub: string;
  role: Role;
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: AccessTokenClaims;
    user: AccessTokenClaims;
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Verifies the Bearer access token and sets `request.user`. */
    authenticate: preHandlerAsyncHookHandler;
    /** Allows only the given roles. Use after `authenticate`. */
    authorize: (...roles: Role[]) => preHandlerAsyncHookHandler;
  }
}

export interface AuthPluginOptions {
  jwtAccessSecret: string;
  /** e.g. "15m" */
  accessTokenTtl: string;
}

const ROLES: readonly Role[] = ['ADMIN', 'OPERATOR'];

function hasValidClaims(user: unknown): user is AccessTokenClaims {
  if (typeof user !== 'object' || user === null) return false;
  const { sub, role } = user as Partial<AccessTokenClaims>;
  return typeof sub === 'string' && sub.length > 0 && ROLES.some((known) => known === role);
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

const authPlugin: FastifyPluginAsync<AuthPluginOptions> = async (app, options) => {
  // Cookies are only read for the refresh token; it is opaque, so no cookie signing.
  await app.register(cookie);
  await app.register(jwt, {
    secret: options.jwtAccessSecret,
    sign: { algorithm: 'HS256', expiresIn: options.accessTokenTtl },
    verify: { algorithms: ['HS256'] },
  });

  app.decorate('authenticate', async (request: FastifyRequest) => {
    try {
      await request.jwtVerify();
    } catch (error) {
      if (errorCode(error) === 'FST_JWT_AUTHORIZATION_TOKEN_EXPIRED') {
        throw new AppError(401, 'TOKEN_EXPIRED', 'Access token has expired');
      }
      throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
    }
    if (!hasValidClaims(request.user)) {
      throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required');
    }
  });

  // Roles are always checked here, on the server, from the signed token.
  app.decorate(
    'authorize',
    (...roles: Role[]): preHandlerAsyncHookHandler =>
      (request: FastifyRequest) => {
        if (!hasValidClaims(request.user)) {
          return Promise.reject(new AppError(401, 'UNAUTHENTICATED', 'Authentication required'));
        }
        if (!roles.includes(request.user.role)) {
          return Promise.reject(
            new AppError(403, 'FORBIDDEN', 'You do not have permission for this action'),
          );
        }
        return Promise.resolve();
      },
  );
};

export default fp(authPlugin, { name: 'auth', fastify: '5.x' });

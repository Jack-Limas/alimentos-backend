export { createAuthController, type AuthController } from './auth.controller.js';
export { authRoutes, type AuthRoutesOptions } from './auth.routes.js';
export {
  createAuthService,
  normalizeEmail,
  type AuthConfig,
  type AuthService,
  type PublicUser,
} from './auth.service.js';
export { createPrismaLoginAttemptRepository } from './login-attempt.prisma-repository.js';
export type { LoginAttemptRepository } from './login-attempt.repository.js';
export { BCRYPT_COST, createBcryptHasher, type PasswordHasher } from './password-hasher.js';
export { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from './refresh-cookie.js';
export { createPrismaRefreshTokenRepository } from './refresh-token.prisma-repository.js';
export type { RefreshTokenRepository } from './refresh-token.repository.js';

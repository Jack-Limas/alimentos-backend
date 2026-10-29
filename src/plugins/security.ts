import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import type { FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

export interface SecurityOptions {
  /** Exact origins allowed to call the API (from CORS_ORIGINS). */
  corsOrigins: string[];
}

const securityPlugin: FastifyPluginAsync<SecurityOptions> = async (app, options) => {
  // Allowlist only: an origin not in the list gets no Access-Control-Allow-Origin
  // header. credentials: true is needed for the HttpOnly refresh cookie
  // (SameSite=None) sent from the frontend on *.vercel.app.
  await app.register(cors, {
    origin: options.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    // Content-Disposition carries the report file name the frontend saves the download with.
    exposedHeaders: ['Server-Timing', 'Retry-After', 'X-Generation-Time-Ms', 'Content-Disposition'],
  });

  // The frontend enables cross-origin isolation (COOP + COEP: require-corp) to
  // use SharedArrayBuffer in its worker pool. Under COEP the browser blocks
  // cross-origin resources that lack Cross-Origin-Resource-Policy, so the API
  // must send CORP "cross-origin" instead of helmet's default "same-origin".
  await app.register(helmet, {
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });
};

export default fp(securityPlugin, { name: 'security', fastify: '5.x' });

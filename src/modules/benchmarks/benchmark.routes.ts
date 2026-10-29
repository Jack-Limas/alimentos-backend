import type { FastifyPluginCallback } from 'fastify';
import type { BenchmarkController } from './benchmark.controller.js';

export interface BenchmarkRoutesOptions {
  controller: BenchmarkController;
}

// Mounted under /api/v1/benchmarks (contract 4.10): ADMIN only. The main-thread
// half of the benchmark blocks the server on purpose, so it is not for everyone.
export const benchmarkRoutes: FastifyPluginCallback<BenchmarkRoutesOptions> = (
  app,
  options,
  done,
) => {
  app.post(
    '/worker-threads',
    { preHandler: [app.authenticate, app.authorize('ADMIN')] },
    options.controller.workerThreads,
  );
  done();
};

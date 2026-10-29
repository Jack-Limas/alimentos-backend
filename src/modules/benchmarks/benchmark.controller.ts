import type { FastifyRequest } from 'fastify';
import { actorOf } from '../../shared/http/actor.js';
import { benchmarkBodySchema } from './benchmark.schemas.js';
import type { BenchmarkReport, BenchmarkService } from './benchmark.service.js';

export interface BenchmarkController {
  workerThreads: (request: FastifyRequest) => Promise<{ data: BenchmarkReport }>;
}

export function createBenchmarkController(service: BenchmarkService): BenchmarkController {
  return {
    workerThreads: async (request) => {
      const { size } = benchmarkBodySchema.parse(request.body);
      return { data: await service.run(size, actorOf(request)) };
    },
  };
}

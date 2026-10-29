import type { FastifyRequest } from 'fastify';
import { actorOf } from '../../shared/http/actor.js';
import { benchmarkBodySchema } from './benchmark.schemas.js';
import {
  BENCHMARK_MAX_SIZE,
  BENCHMARK_MIN_SIZE,
  type BenchmarkReport,
  type BenchmarkService,
} from './benchmark.service.js';

export interface BenchmarkLimits {
  minSize: number;
  maxSize: number;
}

export interface BenchmarkController {
  limits: () => { data: BenchmarkLimits };
  workerThreads: (request: FastifyRequest) => Promise<{ data: BenchmarkReport }>;
}

export function createBenchmarkController(
  service: BenchmarkService,
  maxSize: number = BENCHMARK_MAX_SIZE,
): BenchmarkController {
  const body = benchmarkBodySchema(maxSize);
  return {
    // The frontend sizes its picker with these, so it never offers a size the server refuses.
    limits: () => ({ data: { minSize: BENCHMARK_MIN_SIZE, maxSize } }),
    workerThreads: async (request) => {
      const { size } = body.parse(request.body);
      return { data: await service.run(size, actorOf(request)) };
    },
  };
}

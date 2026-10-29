import { z } from 'zod';
import { BENCHMARK_MAX_SIZE, BENCHMARK_MIN_SIZE } from './benchmark.service.js';

/** `{ size }` between the minimum and the configured maximum (BENCHMARK_MAX_SIZE). */
export function benchmarkBodySchema(maxSize: number = BENCHMARK_MAX_SIZE) {
  return z.strictObject({
    size: z.number().int().min(BENCHMARK_MIN_SIZE).max(maxSize),
  });
}

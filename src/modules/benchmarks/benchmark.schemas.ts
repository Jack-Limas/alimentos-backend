import { z } from 'zod';
import { BENCHMARK_MAX_SIZE, BENCHMARK_MIN_SIZE } from './benchmark.service.js';

export const benchmarkBodySchema = z.strictObject({
  size: z.number().int().min(BENCHMARK_MIN_SIZE).max(BENCHMARK_MAX_SIZE),
});

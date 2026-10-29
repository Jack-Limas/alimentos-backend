import { isDeepStrictEqual } from 'node:util';
import { AUDIT_ACTIONS, type AuditService } from '../audit/index.js';
import { AppError } from '../../shared/errors/index.js';
import type { Actor } from '../../shared/http/actor.js';
import type { TaskPool } from '../../workers/index.js';
import { runHeavyAnalysis, type HeavyAnalysisResult } from './domain/heavy-analysis.js';
import { measureWhile, type Measurement } from './measure.js';

export const BENCHMARK_MIN_SIZE = 1_000;
/**
 * The main-thread run blocks the whole server (every user, every request)
 * for its duration. 30,000 orders take about 1.1 s on a laptop and should
 * stay around 2 s on a small cloud instance; past that the demo would be an
 * outage, so the size is capped here.
 */
export const BENCHMARK_MAX_SIZE = 30_000;
/** A tiny task first, so worker start-up never counts in the measurement. */
const WARM_UP_SIZE = 100;

export interface BenchmarkReport {
  size: number;
  mainThread: Measurement;
  workerPool: Measurement;
  /** Both modes computed the same plan (same checksum and counts). */
  sameResult: boolean;
  result: HeavyAnalysisResult;
  // Contract 4.10 summary fields.
  mainThreadMs: number;
  workerMs: number;
  eventLoopLagMain: number;
  eventLoopLagWorker: number;
}

export interface BenchmarkService {
  run(size: number, actor: Actor): Promise<BenchmarkReport>;
}

export function createBenchmarkService({
  pool,
  audit,
}: {
  pool: TaskPool;
  audit: AuditService;
}): BenchmarkService {
  let running = false;

  return {
    async run(size, actor) {
      // Two benchmarks at once would measure each other: one at a time.
      if (running) {
        throw new AppError(409, 'BENCHMARK_RUNNING', 'Another benchmark is running', {});
      }
      running = true;
      try {
        await pool.run('heavyAnalysis', { size: WARM_UP_SIZE });
        const main = await measureWhile(() => runHeavyAnalysis(size));
        const worker = await measureWhile(() => pool.run('heavyAnalysis', { size }));
        const report: BenchmarkReport = {
          size,
          mainThread: main.measurement,
          workerPool: worker.measurement,
          sameResult: isDeepStrictEqual(main.result, worker.result),
          result: main.result,
          mainThreadMs: main.measurement.durationMs,
          workerMs: worker.measurement.durationMs,
          eventLoopLagMain: main.measurement.eventLoop.maxMs,
          eventLoopLagWorker: worker.measurement.eventLoop.maxMs,
        };
        await audit.record({
          userId: actor.userId,
          action: AUDIT_ACTIONS.BENCHMARK_RUN,
          entity: 'Benchmark',
          entityId: null,
          metadata: { size, mainThreadMs: report.mainThreadMs, workerMs: report.workerMs },
          ip: actor.ip,
        });
        return report;
      } finally {
        running = false;
      }
    },
  };
}

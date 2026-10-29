import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BENCHMARK_MAX_SIZE,
  BENCHMARK_MIN_SIZE,
  measureWhile,
  type BenchmarkReport,
} from '../src/modules/benchmarks/index.js';
import {
  buildInventoryTestApp,
  call,
  type InventoryTestContext,
} from './helpers/inventory-fixtures.js';
import { ADMIN, buildAuthTestApp, login } from './helpers/auth-fixtures.js';
import { auditActions } from './helpers/order-fixtures.js';

const busy = (ms: number) => {
  const until = performance.now() + ms;
  while (performance.now() < until);
  return ms;
};

describe('measureWhile', () => {
  it('sees a synchronous block in the event loop delay and the probe drift', async () => {
    const { result, measurement } = await measureWhile(() => busy(200));
    expect(result).toBe(200);
    expect(measurement.durationMs).toBeGreaterThanOrEqual(200);
    expect(measurement.probe.maxDriftMs).toBeGreaterThanOrEqual(150);
    expect(measurement.eventLoop.maxMs).toBeGreaterThanOrEqual(150);
  });

  it('keeps the loop free while it awaits something else', async () => {
    const { measurement } = await measureWhile(() => sleep(200));
    expect(measurement.durationMs).toBeGreaterThanOrEqual(190);
    expect(measurement.probe.maxDriftMs).toBeLessThan(100);
    // The tick count is not asserted: timers are coarse on Windows (~15.6 ms) and a busy test
    // machine skips ticks. The drift is the signal: no single wait close to the run itself.
    expect(measurement.probe.ticks).toBeGreaterThan(0);
  });
});

describe('POST /benchmarks/worker-threads', { timeout: 60_000 }, () => {
  let context: InventoryTestContext;
  beforeAll(async () => {
    context = await buildInventoryTestApp();
  });
  afterAll(async () => {
    await context.app.close();
  });
  const run = (body: unknown, token = context.adminToken) =>
    call(context.app, token, 'POST', '/api/v1/benchmarks/worker-threads', body);

  it('runs the same analysis on the main thread and in the pool and compares them', async () => {
    const res = await run({ size: 5_000 });

    expect(res.statusCode).toBe(200);
    const report = res.json<{ data: BenchmarkReport }>().data;
    expect(report).toMatchObject({ size: 5_000, sameResult: true, result: { size: 5_000 } });
    // The main thread blocks the loop for about its whole duration; the pool does not.
    expect(report.mainThread.probe.maxDriftMs).toBeGreaterThanOrEqual(
      report.mainThread.durationMs * 0.5,
    );
    expect(report.workerPool.probe.maxDriftMs).toBeLessThan(report.mainThread.probe.maxDriftMs);
    expect(report.mainThreadMs).toBe(report.mainThread.durationMs);
    expect(report.eventLoopLagWorker).toBe(report.workerPool.eventLoop.maxMs);
    expect(auditActions(context)).toContain('BENCHMARK_RUN');
  });

  it('answers 409 BENCHMARK_RUNNING while another benchmark runs', async () => {
    const first = run({ size: BENCHMARK_MIN_SIZE });
    // The second request arrives while the first is still measuring.
    await sleep(5);
    const second = await run({ size: BENCHMARK_MIN_SIZE });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ error: { code: 'BENCHMARK_RUNNING' } });
    expect((await first).statusCode).toBe(200);
    // Free again afterwards.
    expect((await run({ size: BENCHMARK_MIN_SIZE })).statusCode).toBe(200);
  });

  it.each([
    ['too small', { size: BENCHMARK_MIN_SIZE - 1 }],
    ['too large for the main thread', { size: BENCHMARK_MAX_SIZE + 1 }],
    ['not an integer', { size: 1500.5 }],
    ['extra fields', { size: 2_000, mode: 'main' }],
  ])('rejects a size %s with 400', async (_case, body) => {
    expect((await run(body)).statusCode).toBe(400);
  });

  it('is ADMIN only', async () => {
    expect((await run({ size: 1_000 }, context.operatorToken)).statusCode).toBe(403);
    const limits = (token: string) => call(context.app, token, 'GET', '/api/v1/benchmarks/limits');
    expect((await limits(context.operatorToken)).statusCode).toBe(403);
  });

  it('exposes its limits for the frontend', async () => {
    const res = await call(context.app, context.adminToken, 'GET', '/api/v1/benchmarks/limits');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      data: { minSize: BENCHMARK_MIN_SIZE, maxSize: BENCHMARK_MAX_SIZE },
    });
  });
});

describe('BENCHMARK_MAX_SIZE', () => {
  it('lowers the maximum, in the limits and in the validation', async () => {
    const context = await buildAuthTestApp({ env: { BENCHMARK_MAX_SIZE: 8_000 } });
    const token = (await login(context.app, ADMIN)).json<{ accessToken: string }>().accessToken;
    const limits = await call(context.app, token, 'GET', '/api/v1/benchmarks/limits');
    expect(limits.json()).toEqual({ data: { minSize: BENCHMARK_MIN_SIZE, maxSize: 8_000 } });
    const tooBig = await call(context.app, token, 'POST', '/api/v1/benchmarks/worker-threads', {
      size: 8_001,
    });
    expect(tooBig.statusCode).toBe(400);
    expect(JSON.stringify(tooBig.json())).toContain('8000');
    await context.app.close();
  });
});

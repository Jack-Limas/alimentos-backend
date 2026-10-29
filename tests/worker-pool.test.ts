import { afterEach, describe, expect, it } from 'vitest';
import {
  createWorkerPool,
  PoolClosedError,
  TaskFailedError,
  TaskTimeoutError,
  WorkerCrashedError,
  type WorkerPool,
} from '../src/workers/pool.js';
import { resolveWorkerEntry } from '../src/workers/worker-entry.js';

// The fixture is TypeScript, started through the tsx bootstrap: the same path as development.
const entry = resolveWorkerEntry(
  new URL('./fixtures/workers/index.ts', import.meta.url).href,
  'pool-test-worker',
);

let pool: WorkerPool | undefined;

/** Worker start-up (tsx) is slow under a parallel test run: wait for it explicitly. */
async function waitUntilReady(target: WorkerPool, count: number) {
  const until = Date.now() + 15_000;
  while (target.stats().ready < count) {
    if (Date.now() > until) throw new Error('workers did not start');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
const SLOW = { timeout: 30_000 };
afterEach(async () => {
  await pool?.close();
  pool = undefined;
});

describe('resolveWorkerEntry', () => {
  it('starts the .ts worker through the tsx bootstrap when running from the sources (dev, tests)', () => {
    const dev = resolveWorkerEntry('file:///app/src/workers/pool.ts', 'task-worker');
    expect(dev.url.pathname.endsWith('/src/workers/tsx-bootstrap.ts')).toBe(true);
    expect(dev.workerData).toEqual({ entry: 'file:///app/src/workers/task-worker.ts' });
    expect(dev.execArgv).toContain('--experimental-strip-types');
  });

  it('uses the compiled .js worker with plain Node in production (dist)', () => {
    const prod = resolveWorkerEntry('file:///app/dist/workers/pool.js', 'task-worker');
    expect(prod.url.href).toBe('file:///app/dist/workers/task-worker.js');
    expect(prod.execArgv).toEqual([]);
    expect(prod.workerData).toBeUndefined();
  });
});

describe('createWorkerPool', () => {
  it('runs tasks in 2 worker threads in parallel and queues the rest', SLOW, async () => {
    const twoWorkers = createWorkerPool({ entry, size: 2 });
    pool = twoWorkers;
    // Let both workers boot first (the timing below is about running, not starting).
    await waitUntilReady(twoWorkers, 2);
    const started = Date.now();
    const runs = [1, 2, 3, 4].map(() => twoWorkers.run<{ threadId: number }>('sleep', 300));
    expect(pool.stats()).toMatchObject({ size: 2, busy: 2, queued: 2 });

    const results = await Promise.all(runs);
    const elapsed = Date.now() - started;
    expect(new Set(results.map((r) => r.threadId)).size).toBe(2);
    // Two rounds of 300 ms, not four.
    expect(elapsed).toBeGreaterThanOrEqual(550);
    expect(elapsed).toBeLessThan(1_150);
    expect(pool.stats()).toMatchObject({ ready: 2, busy: 0, queued: 0, restarts: 0 });
  });

  it('returns results and rejects a task that throws without losing the worker', SLOW, async () => {
    pool = createWorkerPool({ entry, size: 1 });
    await expect(pool.run('throw', 'bad input')).rejects.toEqual(new TaskFailedError('bad input'));
    await expect(pool.run('echo', { a: 1 })).resolves.toMatchObject({ payload: { a: 1 } });
    expect(pool.stats().restarts).toBe(0);
  });

  it('times out a slow task, replaces its worker and keeps serving the queue', SLOW, async () => {
    pool = createWorkerPool({ entry, size: 1, taskTimeoutMs: 200 });
    const slow = pool.run('sleep', 5_000);
    const next = pool.run('echo', 'after');

    await expect(slow).rejects.toBeInstanceOf(TaskTimeoutError);
    await expect(next).resolves.toMatchObject({ payload: 'after' });
    expect(pool.stats().restarts).toBe(1);
  });

  it('restarts a worker that dies and rejects only its task', SLOW, async () => {
    pool = createWorkerPool({ entry, size: 1 });
    const first = await pool.run<{ threadId: number }>('echo', 1);

    await expect(pool.run('crash', null)).rejects.toBeInstanceOf(WorkerCrashedError);
    const after = await pool.run<{ threadId: number }>('echo', 2);
    expect(after.threadId).not.toBe(first.threadId);
    expect(pool.stats().restarts).toBe(1);
  });

  it('does not count worker start-up against the task timeout', SLOW, async () => {
    // A fresh pool: the tsx workers take a while to load, longer than this timeout.
    pool = createWorkerPool({ entry, size: 1, taskTimeoutMs: 150 });
    await expect(pool.run('echo', 'first')).resolves.toMatchObject({ payload: 'first' });
  });

  it('rejects queued and new tasks once closed', SLOW, async () => {
    pool = createWorkerPool({ entry, size: 1 });
    const running = expect(pool.run('sleep', 2_000)).rejects.toBeInstanceOf(PoolClosedError);
    const queued = expect(pool.run('echo', 'never')).rejects.toBeInstanceOf(PoolClosedError);
    await pool.close();

    await running;
    await queued;
    await expect(pool.run('echo', 1)).rejects.toBeInstanceOf(PoolClosedError);
    pool = undefined;
  });
});

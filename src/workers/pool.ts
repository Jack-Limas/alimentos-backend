import { Worker } from 'node:worker_threads';
import type { WorkerEntry } from './worker-entry.js';

export const DEFAULT_POOL_SIZE = 2;
export const DEFAULT_TASK_TIMEOUT_MS = 30_000;

/** Message protocol between the pool and its workers. */
export interface TaskRequest {
  id: number;
  type: string;
  payload: unknown;
}

/** A worker posts READY once its modules are loaded; only then it gets tasks. */
export const READY_MESSAGE = { ready: true } as const;

export type TaskResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: { name: string; message: string } };

export class TaskTimeoutError extends Error {
  constructor(
    public readonly type: string,
    timeoutMs: number,
  ) {
    super(`Task ${type} took longer than ${String(timeoutMs)} ms`);
    this.name = 'TaskTimeoutError';
  }
}

export class WorkerCrashedError extends Error {
  constructor(message: string) {
    super(`Worker crashed: ${message}`);
    this.name = 'WorkerCrashedError';
  }
}

/** The task itself threw inside the worker (the worker is still healthy). */
export class TaskFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaskFailedError';
  }
}

export class PoolClosedError extends Error {
  constructor() {
    super('The worker pool is closed');
    this.name = 'PoolClosedError';
  }
}

export interface PoolOptions {
  entry: WorkerEntry;
  size?: number;
  taskTimeoutMs?: number;
  /** Thread name, visible in profilers and crash messages. */
  name?: string;
}

export interface PoolStats {
  size: number;
  busy: number;
  queued: number;
  /** Workers replaced after a crash or a timeout since the pool started. */
  restarts: number;
}

export interface WorkerPool {
  run<T>(type: string, payload: unknown): Promise<T>;
  stats(): PoolStats;
  close(): Promise<void>;
}

interface Job {
  id: number;
  type: string;
  payload: unknown;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface Slot {
  worker: Worker;
  /** False until the worker posts READY: boot time never counts against a task timeout. */
  ready: boolean;
  job: Job | null;
  timer: NodeJS.Timeout | null;
}

/**
 * A minimal pool on node:worker_threads (no library): `size` workers, a FIFO
 * queue, one task per ready worker at a time, a timeout per task, and a fresh
 * worker whenever one dies or times out (a timed-out task cannot be stopped
 * inside a thread, so its worker is terminated).
 */
export function createWorkerPool({
  entry,
  size = DEFAULT_POOL_SIZE,
  taskTimeoutMs = DEFAULT_TASK_TIMEOUT_MS,
  name = 'aiq-worker',
}: PoolOptions): WorkerPool {
  const queue: Job[] = [];
  const slots: Slot[] = [];
  let nextId = 1;
  let restarts = 0;
  let closed = false;

  function spawn(slot: Slot): Worker {
    const worker = new Worker(entry.url, { execArgv: entry.execArgv, name });
    worker.on('message', (message: TaskResponse | typeof READY_MESSAGE) => {
      if (slot.worker !== worker) return;
      if ('ready' in message) {
        slot.ready = true;
        dispatch();
        return;
      }
      finish(slot, message);
    });
    worker.on('error', (error) => {
      if (slot.worker === worker) fail(slot, new WorkerCrashedError(error.message));
    });
    worker.on('exit', (code) => {
      if (slot.worker === worker && !closed)
        fail(slot, new WorkerCrashedError(`exit code ${String(code)}`));
    });
    return worker;
  }

  function replace(slot: Slot): void {
    const old = slot.worker;
    old.removeAllListeners();
    old.on('error', () => undefined);
    void old.terminate();
    restarts += 1;
    slot.ready = false;
    slot.worker = spawn(slot);
  }

  function release(slot: Slot): Job | null {
    const job = slot.job;
    if (slot.timer) clearTimeout(slot.timer);
    slot.timer = null;
    slot.job = null;
    return job;
  }

  function finish(slot: Slot, message: TaskResponse): void {
    if (slot.job?.id !== message.id) return;
    const job = release(slot);
    if (message.ok) job?.resolve(message.result);
    else job?.reject(new TaskFailedError(message.error.message));
    dispatch();
  }

  function fail(slot: Slot, error: Error): void {
    release(slot)?.reject(error);
    replace(slot);
    dispatch();
  }

  function dispatch(): void {
    for (const slot of slots) {
      if (slot.job || !slot.ready) continue;
      const job = queue.shift();
      if (!job) return;
      slot.job = job;
      slot.timer = setTimeout(() => {
        if (slot.job === job) fail(slot, new TaskTimeoutError(job.type, taskTimeoutMs));
      }, taskTimeoutMs);
      slot.worker.postMessage({
        id: job.id,
        type: job.type,
        payload: job.payload,
      } satisfies TaskRequest);
    }
  }

  for (let i = 0; i < size; i += 1) {
    const slot = { ready: false, job: null, timer: null } as unknown as Slot;
    slot.worker = spawn(slot);
    slots.push(slot);
  }

  return {
    run<T>(type: string, payload: unknown): Promise<T> {
      if (closed) return Promise.reject(new PoolClosedError());
      return new Promise<T>((resolve, reject) => {
        queue.push({
          id: nextId++,
          type,
          payload,
          resolve: resolve as (value: unknown) => void,
          reject,
        });
        dispatch();
      });
    },

    stats: () => ({
      size: slots.length,
      busy: slots.filter((slot) => slot.job).length,
      queued: queue.length,
      restarts,
    }),

    async close() {
      closed = true;
      for (const job of queue.splice(0)) job.reject(new PoolClosedError());
      await Promise.all(
        slots.map(async (slot) => {
          release(slot)?.reject(new PoolClosedError());
          slot.worker.removeAllListeners();
          await slot.worker.terminate();
        }),
      );
    },
  };
}

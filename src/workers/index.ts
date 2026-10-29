import { createWorkerPool, type PoolOptions, type WorkerPool } from './pool.js';
import type { TaskName, Tasks } from './tasks.js';
import { resolveWorkerEntry } from './worker-entry.js';

export {
  DEFAULT_POOL_SIZE,
  DEFAULT_TASK_TIMEOUT_MS,
  PoolClosedError,
  TaskFailedError,
  TaskTimeoutError,
  WorkerCrashedError,
  type PoolStats,
} from './pool.js';
export type { TaskName, Tasks } from './tasks.js';
export { resolveWorkerEntry } from './worker-entry.js';

/** The pool typed with the app's tasks. */
export interface TaskPool {
  run<K extends TaskName>(task: K, payload: Tasks[K]['payload']): Promise<Tasks[K]['result']>;
  stats: WorkerPool['stats'];
  close: WorkerPool['close'];
}

/** The app's pool of task-worker threads (.ts with tsx in dev, .js in dist). */
export function createTaskPool(options: Omit<PoolOptions, 'entry'> = {}): TaskPool {
  const pool = createWorkerPool({
    ...options,
    name: options.name ?? 'aiq-task-worker',
    entry: resolveWorkerEntry(import.meta.url, 'task-worker'),
  });
  return {
    run: (task, payload) => pool.run(task, payload),
    stats: () => pool.stats(),
    close: () => pool.close(),
  };
}

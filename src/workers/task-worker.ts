// Worker thread entry: runs the tasks of tasks.ts for the pool (see pool.ts).
// Started as task-worker.ts with --import tsx in development and tests, and
// as dist/workers/task-worker.js in production (resolveWorkerEntry).
import { parentPort } from 'node:worker_threads';
import { READY_MESSAGE, type TaskRequest, type TaskResponse } from './pool.js';
import { TASKS, type TaskName } from './tasks.js';

const port = parentPort;
if (!port) throw new Error('task-worker must run in a worker thread');

port.on('message', ({ id, type, payload }: TaskRequest) => {
  const task = TASKS[type as TaskName] as ((input: unknown) => unknown) | undefined;
  const reply = (response: TaskResponse) => {
    port.postMessage(response);
  };
  if (!task) {
    reply({ id, ok: false, error: { name: 'Error', message: `Unknown task ${type}` } });
    return;
  }
  Promise.resolve()
    .then(() => task(payload))
    .then(
      (result) => {
        reply({ id, ok: true, result });
      },
      (error: unknown) => {
        const failure = error instanceof Error ? error : new Error(String(error));
        reply({ id, ok: false, error: { name: failure.name, message: failure.message } });
      },
    );
});

port.postMessage(READY_MESSAGE);

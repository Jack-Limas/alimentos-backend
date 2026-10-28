// TypeScript worker for the pool tests (run with --import tsx, like development):
// echo, sleep, block, throw and crash on demand.
import { parentPort, threadId } from 'node:worker_threads';

interface Request {
  id: number;
  type: string;
  payload: unknown;
}

const port = parentPort;
if (!port) throw new Error('must run as a worker');

port.on('message', ({ id, type, payload }: Request) => {
  const reply = (result: unknown) => {
    port.postMessage({ id, ok: true, result });
  };
  switch (type) {
    case 'echo':
      reply({ payload, threadId });
      return;
    case 'sleep':
      setTimeout(() => {
        reply({ slept: payload, threadId });
      }, Number(payload));
      return;
    case 'throw':
      port.postMessage({ id, ok: false, error: { name: 'Error', message: String(payload) } });
      return;
    case 'crash':
      process.exit(3);
      return;
    default:
      port.postMessage({
        id,
        ok: false,
        error: { name: 'Error', message: `unknown task ${type}` },
      });
  }
});

port.postMessage({ ready: true });

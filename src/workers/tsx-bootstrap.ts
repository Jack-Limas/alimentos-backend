// Development and tests only: the first module of a worker thread that runs
// TypeScript sources. Node loads this file with its built-in type stripping,
// then tsx is registered through its API (a `--import tsx` flag does not reach
// worker threads) so the real entry can import `./x.js` → `./x.ts`.
import { workerData } from 'node:worker_threads';
import { register } from 'tsx/esm/api';

register();
await import((workerData as { entry: string }).entry);

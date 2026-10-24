import type { DatabaseCheck } from './health.repository.js';

export interface LivenessStatus {
  status: 'ok';
  service: string;
  version: string;
  uptimeSec: number;
}

export type ReadinessStatus = { status: 'ok'; db: 'up' } | { status: 'degraded'; db: 'down' };

export interface HealthServiceDeps {
  serviceName: string;
  version: string;
  checkDatabase: DatabaseCheck;
  /** Max time to wait for the database before reporting it as down. */
  dbTimeoutMs?: number;
  onDatabaseError?: (error: unknown) => void;
}

export interface HealthService {
  getLiveness(): LivenessStatus;
  getReadiness(): Promise<ReadinessStatus>;
}

// Neon may need a few seconds to wake a suspended compute.
const DEFAULT_DB_TIMEOUT_MS = 5000;

function withTimeout(check: DatabaseCheck, timeoutMs: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Database check timed out after ${timeoutMs} ms`));
    }, timeoutMs);
  });
  return Promise.race([check(), timeout]).finally(() => {
    clearTimeout(timer);
  });
}

export function createHealthService(deps: HealthServiceDeps): HealthService {
  const dbTimeoutMs = deps.dbTimeoutMs ?? DEFAULT_DB_TIMEOUT_MS;

  return {
    getLiveness() {
      return {
        status: 'ok',
        service: deps.serviceName,
        version: deps.version,
        uptimeSec: Math.floor(process.uptime()),
      };
    },

    async getReadiness() {
      try {
        await withTimeout(deps.checkDatabase, dbTimeoutMs);
        return { status: 'ok', db: 'up' };
      } catch (error) {
        deps.onDatabaseError?.(error);
        return { status: 'degraded', db: 'down' };
      }
    },
  };
}

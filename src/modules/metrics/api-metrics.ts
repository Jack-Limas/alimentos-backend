import { RingBuffer, summarize, type Summary } from './domain/index.js';

/** Durations kept per route: enough for stable p95/p99, bounded memory. */
export const API_METRICS_CAPACITY = 500;

export interface RouteMetrics extends Summary {
  /** "GET /api/v1/orders/:id": the route pattern, never the URL with IDs. */
  route: string;
  /** Requests seen since start (the percentiles use the last 500 only). */
  total: number;
  errors5xx: number;
}

export interface ApiMetrics {
  record(route: string, durationMs: number, statusCode: number): void;
  routes(): RouteMetrics[];
}

interface RouteState {
  durations: RingBuffer<number>;
  total: number;
  errors5xx: number;
}

/** Per-route response times in memory (one instance per process). */
export function createApiMetrics(capacity = API_METRICS_CAPACITY): ApiMetrics {
  const byRoute = new Map<string, RouteState>();

  return {
    record(route, durationMs, statusCode) {
      let state = byRoute.get(route);
      if (!state) {
        state = { durations: new RingBuffer<number>(capacity), total: 0, errors5xx: 0 };
        byRoute.set(route, state);
      }
      state.durations.push(durationMs);
      state.total += 1;
      if (statusCode >= 500) state.errors5xx += 1;
    },

    routes() {
      return [...byRoute]
        .map(([route, state]) => ({
          route,
          total: state.total,
          errors5xx: state.errors5xx,
          ...summarize(state.durations.values()),
        }))
        .sort((a, b) => b.total - a.total || a.route.localeCompare(b.route));
    },
  };
}

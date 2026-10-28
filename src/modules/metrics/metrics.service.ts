import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';
import type { ApiMetrics, RouteMetrics } from './api-metrics.js';
import type { WebVital, WebVitalsReport, WebVitalsStore } from './web-vitals.js';

const NS_PER_MS = 1e6;
const ms = (ns: number) => Math.round((ns / NS_PER_MS) * 100) / 100;

export interface EventLoopLag {
  meanMs: number;
  p99Ms: number;
  maxMs: number;
}

export interface ApiMetricsReport {
  routes: RouteMetrics[];
  memory: NodeJS.MemoryUsage;
  eventLoop: EventLoopLag;
  uptimeSec: number;
}

export interface MetricsService {
  api(): ApiMetricsReport;
  addWebVital(vital: WebVital): void;
  webVitals(): WebVitalsReport;
  close(): void;
}

/** Reads an event loop delay histogram in milliseconds. */
export function readLag(histogram: IntervalHistogram): EventLoopLag {
  return {
    meanMs: Number.isNaN(histogram.mean) ? 0 : ms(histogram.mean),
    p99Ms: ms(histogram.percentile(99)),
    maxMs: ms(histogram.max),
  };
}

export function createMetricsService({
  apiMetrics,
  webVitals,
}: {
  apiMetrics: ApiMetrics;
  webVitals: WebVitalsStore;
}): MetricsService {
  // Event loop delay since the process started (20 ms sampling: cheap, enough for p99/max).
  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();

  return {
    api: () => ({
      routes: apiMetrics.routes(),
      memory: process.memoryUsage(),
      eventLoop: readLag(histogram),
      uptimeSec: Math.round(process.uptime()),
    }),
    addWebVital: (vital) => {
      webVitals.add(vital);
    },
    webVitals: () => webVitals.report(),
    close: () => {
      histogram.disable();
    },
  };
}

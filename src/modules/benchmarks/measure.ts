import { monitorEventLoopDelay } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';

/** The "is the server still answering?" probe: a timer that should fire every 10 ms. */
export const PROBE_INTERVAL_MS = 10;
/** After the run, the probe and the histogram need a moment to see the end of a block. */
const SETTLE_MS = 40;

export interface Measurement {
  durationMs: number;
  eventLoop: { maxMs: number; p99Ms: number };
  probe: {
    intervalMs: number;
    /** Ticks that fired from the start of the run until it settled. */
    ticks: number;
    expectedTicks: number;
    /** Longest extra wait of a tick beyond its 10 ms: how long nothing else could run. */
    maxDriftMs: number;
  };
}

const round1 = (value: number) => Math.round(value * 10) / 10;
const nsToMs = (ns: number) => round1(ns / 1e6);

/**
 * Runs `task` while measuring how the event loop copes: its delay
 * (monitorEventLoopDelay, max and p99) and the drift of a 10 ms setInterval.
 * A synchronous task on the main thread blocks both for its whole duration;
 * a task awaited from a worker thread leaves them almost untouched.
 */
export async function measureWhile<T>(
  task: () => T | Promise<T>,
): Promise<{ result: T; measurement: Measurement }> {
  const histogram = monitorEventLoopDelay({ resolution: PROBE_INTERVAL_MS });
  let ticks = 0;
  let maxDrift = 0;
  let last = performance.now();
  const probe = setInterval(() => {
    const now = performance.now();
    maxDrift = Math.max(maxDrift, now - last - PROBE_INTERVAL_MS);
    last = now;
    ticks += 1;
  }, PROBE_INTERVAL_MS);

  // Let the probe and the histogram's own timer settle into their rhythm. The
  // histogram is new and the settle period is idle, so it is not reset: reset()
  // also forgets its last timestamp and the next delay (the block) would be lost.
  histogram.enable();
  await sleep(3 * PROBE_INTERVAL_MS);
  ticks = 0;
  maxDrift = 0;
  last = performance.now();
  const start = performance.now();
  try {
    const result = await task();
    const durationMs = performance.now() - start;
    await sleep(SETTLE_MS);
    const elapsed = performance.now() - start;
    return {
      result,
      measurement: {
        durationMs: round1(durationMs),
        eventLoop: { maxMs: nsToMs(histogram.max), p99Ms: nsToMs(histogram.percentile(99)) },
        probe: {
          intervalMs: PROBE_INTERVAL_MS,
          ticks,
          expectedTicks: Math.floor(elapsed / PROBE_INTERVAL_MS),
          maxDriftMs: round1(Math.max(0, maxDrift)),
        },
      },
    };
  } finally {
    clearInterval(probe);
    histogram.disable();
  }
}

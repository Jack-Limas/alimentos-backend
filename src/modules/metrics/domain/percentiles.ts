/**
 * Nearest-rank percentile (p in 0–100) of the values, or null when empty:
 * the smallest value such that at least p % of the values are ≤ it. It is
 * always one of the measured values, never an interpolation.
 */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((Math.min(100, Math.max(0, p)) / 100) * sorted.length));
  return sorted[rank - 1] ?? null;
}

export interface Summary {
  count: number;
  p50: number | null;
  p75: number | null;
  p95: number | null;
  p99: number | null;
}

/** p50/p75/p95/p99 rounded to 2 decimals, sorting the values once. */
export function summarize(values: readonly number[]): Summary {
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (p: number) => {
    const value = percentile(sorted, p);
    return value === null ? null : Math.round(value * 100) / 100;
  };
  return { count: sorted.length, p50: pick(50), p75: pick(75), p95: pick(95), p99: pick(99) };
}

import { z } from 'zod';
import { RingBuffer, summarize } from './domain/index.js';

export const WEB_VITALS_CAPACITY = 2_000;
export const WEB_VITAL_NAMES = ['INP', 'LCP', 'CLS', 'TTFB', 'FCP'] as const;
export type WebVitalName = (typeof WEB_VITAL_NAMES)[number];

/**
 * POST /metrics/web-vitals body. `page` is a path pattern sent by the
 * frontend (no query string, no host): it never carries personal data.
 */
export const webVitalSchema = z.strictObject({
  name: z.enum(WEB_VITAL_NAMES),
  // CLS is unitless (usually < 1); the others are milliseconds. One minute is a sane cap.
  value: z.number().min(0).max(60_000),
  rating: z.enum(['good', 'needs-improvement', 'poor']),
  page: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^\/[A-Za-z0-9/_\-[\].]*$/, 'must be a path without query or host'),
});

export type WebVital = z.infer<typeof webVitalSchema>;

export interface VitalSummary {
  name: WebVitalName;
  count: number;
  p75: number | null;
}

export interface WebVitalsReport {
  byMetric: VitalSummary[];
  byPage: (VitalSummary & { page: string })[];
}

export interface WebVitalsStore {
  add(vital: WebVital): void;
  report(): WebVitalsReport;
}

/** Last WEB_VITALS_CAPACITY samples in memory; p75 is what Core Web Vitals use. */
export function createWebVitalsStore(capacity = WEB_VITALS_CAPACITY): WebVitalsStore {
  const samples = new RingBuffer<WebVital>(capacity);

  const p75 = (values: number[]) => summarize(values).p75;

  return {
    add(vital) {
      samples.push(vital);
    },

    report() {
      const all = samples.values();
      const byMetric = WEB_VITAL_NAMES.map((name) => {
        const values = all.filter((s) => s.name === name).map((s) => s.value);
        return { name, count: values.length, p75: p75(values) };
      }).filter((entry) => entry.count > 0);

      const groups = new Map<string, number[]>();
      for (const sample of all) {
        const key = `${sample.page}\u0000${sample.name}`;
        groups.set(key, [...(groups.get(key) ?? []), sample.value]);
      }
      const byPage = [...groups]
        .map(([key, values]) => {
          const [page = '', name] = key.split('\u0000');
          return { page, name: name as WebVitalName, count: values.length, p75: p75(values) };
        })
        .sort((a, b) => a.page.localeCompare(b.page) || a.name.localeCompare(b.name));

      return { byMetric, byPage };
    },
  };
}

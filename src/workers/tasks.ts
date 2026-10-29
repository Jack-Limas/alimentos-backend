import {
  runHeavyAnalysis,
  type HeavyAnalysisResult,
} from '../modules/benchmarks/domain/heavy-analysis.js';
import { toCsv } from '../modules/reports/domain/csv.js';
import { toPdf } from '../modules/reports/domain/pdf.js';
import type {
  RenderedReport,
  ReportDocument,
  ReportFormat,
} from '../modules/reports/domain/report-document.js';

/** The tasks the pool runs, with their payload and result. */
export interface Tasks {
  buildReport: {
    payload: { document: ReportDocument; format: ReportFormat };
    result: RenderedReport;
  };
  heavyAnalysis: { payload: { size: number; seed?: number }; result: HeavyAnalysisResult };
}

export type TaskName = keyof Tasks;

/** Formats a report read on the main thread. CPU work only: no database here. */
export async function buildReport({
  document,
  format,
}: Tasks['buildReport']['payload']): Promise<RenderedReport> {
  return format === 'csv'
    ? { body: toCsv(document), contentType: 'text/csv; charset=utf-8', extension: 'csv' }
    : { body: await toPdf(document), contentType: 'application/pdf', extension: 'pdf' };
}

export function heavyAnalysis({
  size,
  seed,
}: Tasks['heavyAnalysis']['payload']): HeavyAnalysisResult {
  return runHeavyAnalysis(size, seed);
}

export const TASKS: {
  [K in TaskName]: (
    payload: Tasks[K]['payload'],
  ) => Tasks[K]['result'] | Promise<Tasks[K]['result']>;
} = {
  buildReport,
  heavyAnalysis,
};

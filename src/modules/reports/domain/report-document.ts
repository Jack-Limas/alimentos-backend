/**
 * A report as plain data, built on the main thread from the database and
 * sent to a worker to become CSV or PDF (structured clone: no classes, no Dates).
 */
export type ReportLocale = 'es' | 'en';
export type ReportFormat = 'csv' | 'pdf';
export type ReportKind = 'inventory' | 'orders' | 'waste';
export type Cell = string | number | null;

export interface ReportColumn {
  label: string;
  /** Numbers are right-aligned and formatted per locale. */
  kind: 'text' | 'number';
  /** Relative width in the PDF table. */
  width?: number;
}

export interface ReportTotal {
  label: string;
  value: string;
}

export interface ReportTable {
  title?: string;
  columns: ReportColumn[];
  rows: Cell[][];
  totals: ReportTotal[];
  /** Shown instead of an empty table. */
  emptyText: string;
}

export interface ReportDocument {
  kind: ReportKind;
  locale: ReportLocale;
  title: string;
  /** e.g. the date range of the report. */
  subtitle?: string;
  /** "Generado el 28 oct 2026, 18:03 (Bogotá)", already formatted. */
  generatedLabel: string;
  pageLabel: string;
  tables: ReportTable[];
}

export interface RenderedReport {
  body: Uint8Array;
  contentType: string;
  extension: ReportFormat;
}

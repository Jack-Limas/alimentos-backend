import type { Cell, ReportDocument, ReportLocale, ReportTable } from './report-document.js';

/** Byte order mark: without it Excel opens UTF-8 as ANSI and breaks the accents. */
export const UTF8_BOM = '﻿';

/** Excel in Spanish expects ";" (the comma is the decimal separator); English uses ",". */
export function csvSeparator(locale: ReportLocale): ';' | ',' {
  return locale === 'es' ? ';' : ',';
}

/**
 * Cells that a spreadsheet would run as a formula (CSV injection, OWASP):
 * starting with = + - @, a tab or a carriage return.
 */
const FORMULA_START = /^[=+\-@\t\r]/;

function formatNumber(value: number, locale: ReportLocale): string {
  const text = String(Math.round(value * 1000) / 1000);
  return locale === 'es' ? text.replace('.', ',') : text;
}

/**
 * One CSV field. Text that could be a formula gets a leading "'"; fields with
 * the separator, quotes or line breaks are quoted and their quotes doubled.
 * Numbers are data, not text: they are never prefixed.
 */
export function csvCell(value: Cell, locale: ReportLocale): string {
  if (value === null) return '';
  const separator = csvSeparator(locale);
  const text =
    typeof value === 'number'
      ? formatNumber(value, locale)
      : FORMULA_START.test(value)
        ? `'${value}`
        : value;
  return text.includes(separator) || /["\r\n]/.test(text) || text !== text.trim()
    ? `"${text.replace(/"/g, '""')}"`
    : text;
}

function tableLines(table: ReportTable, locale: ReportLocale): string[] {
  const separator = csvSeparator(locale);
  const line = (cells: Cell[]) => cells.map((cell) => csvCell(cell, locale)).join(separator);
  return [
    ...(table.title ? [line([table.title])] : []),
    line(table.columns.map((column) => column.label)),
    ...table.rows.map(line),
    ...table.totals.map((total) => line([total.label, total.value])),
  ];
}

/** BOM + tables (a title row before each one when there are several), CRLF line ends. */
export function toCsv(document: ReportDocument): Uint8Array {
  const blocks = document.tables.map((table) => tableLines(table, document.locale).join('\r\n'));
  return new TextEncoder().encode(`${UTF8_BOM}${blocks.join('\r\n\r\n')}\r\n`);
}

import { describe, expect, it } from 'vitest';
import { csvCell, toCsv, UTF8_BOM } from '../src/modules/reports/domain/csv.js';
import { toPdf } from '../src/modules/reports/domain/pdf.js';
import type { ReportDocument, ReportTable } from '../src/modules/reports/domain/report-document.js';

const table = (rows: ReportTable['rows'], title?: string): ReportTable => ({
  ...(title ? { title } : {}),
  columns: [
    { label: 'Producto', kind: 'text' },
    { label: 'Cantidad', kind: 'number' },
  ],
  rows,
  totals: [{ label: 'Total', value: '15,5 kg' }],
  emptyText: 'Sin datos',
});

const doc = (locale: 'es' | 'en', tables: ReportTable[]): ReportDocument => ({
  kind: 'inventory',
  locale,
  title: 'Inventario',
  generatedLabel: 'Generado el 28 oct 2026, 18:03 (Bogotá)',
  pageLabel: 'Página {page} de {pages}',
  tables,
});

// ignoreBOM keeps the BOM in the decoded text (TextDecoder strips it by default).
const text = (bytes: Uint8Array) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);

describe('CSV', () => {
  it('starts with a UTF-8 BOM so Excel shows the accents', () => {
    const bytes = toCsv(doc('es', [table([['Piña', 1]])]));
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(text(bytes).startsWith(UTF8_BOM)).toBe(true);
    expect(text(bytes)).toContain('Piña');
  });

  it('uses ";" and decimal comma in Spanish, "," and decimal point in English', () => {
    expect(text(toCsv(doc('es', [table([['Arroz', 12.5]])])))).toBe(
      `${UTF8_BOM}Producto;Cantidad\r\nArroz;12,5\r\nTotal;"15,5 kg"\r\n`.replace(
        '"15,5 kg"',
        '15,5 kg',
      ),
    );
    expect(text(toCsv(doc('en', [table([['Rice', 12.5]])])))).toBe(
      `${UTF8_BOM}Producto,Cantidad\r\nRice,12.5\r\nTotal,"15,5 kg"\r\n`,
    );
  });

  it('quotes fields with the separator, quotes or line breaks and doubles the quotes', () => {
    expect(csvCell('Leche; entera', 'es')).toBe('"Leche; entera"');
    expect(csvCell('Leche, entera', 'es')).toBe('Leche, entera');
    expect(csvCell('Leche, entera', 'en')).toBe('"Leche, entera"');
    expect(csvCell('Queso "doble crema"', 'es')).toBe('"Queso ""doble crema"""');
    expect(csvCell('línea 1\nlínea 2', 'es')).toBe('"línea 1\nlínea 2"');
    expect(csvCell(' espacio', 'es')).toBe('" espacio"');
    expect(csvCell(null, 'es')).toBe('');
  });

  it.each(['=SUM(A1:A9)', '+57 300', '-1+2', '@cmd', '\tTAB', '\rCR'])(
    'neutralizes CSV injection in %j',
    (value) => {
      expect(csvCell(value, 'en').replace(/^"/, '').startsWith("'")).toBe(true);
    },
  );

  it('keeps negative numbers as numbers (no prefix)', () => {
    expect(csvCell(-3.25, 'es')).toBe('-3,25');
    expect(csvCell(-3.25, 'en')).toBe('-3.25');
  });

  it('writes several tables with a title row and a blank line between them', () => {
    const csv = text(toCsv(doc('es', [table([['A', 1]], 'Mermas'), table([], 'En riesgo')])));
    expect(csv).toContain('Mermas\r\nProducto;Cantidad\r\nA;1');
    expect(csv).toContain('\r\n\r\nEn riesgo\r\nProducto;Cantidad');
  });
});

describe('PDF', () => {
  it('renders a valid PDF with a paginated table', async () => {
    const rows = Array.from({ length: 120 }, (_, i) => [
      `Producto ${String(i + 1)} con tildes áéíóú ñ`,
      i * 1.5,
    ]);
    const bytes = await toPdf(doc('es', [table(rows), table([], 'Vacía')]));
    const raw = Buffer.from(bytes).toString('latin1');

    expect(raw.startsWith('%PDF-')).toBe(true);
    expect(raw.trimEnd().endsWith('%%EOF')).toBe(true);
    const pages = raw.match(/\/Type \/Page\b/g)?.length ?? 0;
    expect(pages).toBeGreaterThanOrEqual(3);
    expect(raw).toContain('/Title');
  });

  it('switches to landscape for wide tables', async () => {
    const wide: ReportTable = {
      columns: Array.from({ length: 8 }, (_, i) => ({
        label: `C${String(i)}`,
        kind: 'text' as const,
      })),
      rows: [Array.from({ length: 8 }, () => 'x')],
      totals: [],
      emptyText: '',
    };
    const raw = Buffer.from(await toPdf(doc('en', [wide]))).toString('latin1');
    // A4 landscape: 841.89 wide, 595.28 high.
    expect(raw).toMatch(/\/MediaBox \[0 0 841\.89\d* 595\.28/);
  });
});

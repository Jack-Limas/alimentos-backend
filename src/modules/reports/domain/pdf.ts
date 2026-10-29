import PDFDocument from 'pdfkit';
import type { Cell, ReportDocument, ReportLocale, ReportTable } from './report-document.js';

const MARGIN = 40;
const ROW_HEIGHT = 18;
const HEADER_HEIGHT = 22;
const FONT_SIZE = 8.5;
const COLORS = {
  ink: '#1d2a22',
  muted: '#5f6b63',
  header: '#1f5135',
  headerText: '#ffffff',
  zebra: '#f2f6f1',
  rule: '#d9e2d6',
};

function formatCell(value: Cell, locale: ReportLocale): string {
  if (value === null) return '';
  if (typeof value === 'number') {
    return new Intl.NumberFormat(locale === 'es' ? 'es-CO' : 'en-US', {
      maximumFractionDigits: 3,
    }).format(value);
  }
  return value;
}

/**
 * Renders the report as an A4 PDF (landscape for wide tables): title, date of
 * generation, each table with its header repeated on every page, totals and
 * "page X of Y" in the footer. Standard Helvetica covers Spanish accents.
 */
export function toPdf(document: ReportDocument): Promise<Uint8Array> {
  const wide = document.tables.some((table) => table.columns.length > 6);
  const pdf = new PDFDocument({
    size: 'A4',
    layout: wide ? 'landscape' : 'portrait',
    margin: MARGIN,
    bufferPages: true,
    info: { Title: document.title, Author: 'AlimentaIQ', Creator: 'alimentos-backend' },
  });
  const chunks: Buffer[] = [];
  pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Uint8Array>((resolve, reject) => {
    pdf.on('end', () => {
      resolve(new Uint8Array(Buffer.concat(chunks)));
    });
    pdf.on('error', reject);
  });

  const left = MARGIN;
  const width = pdf.page.width - MARGIN * 2;
  const bottom = () => pdf.page.height - MARGIN - 24;

  pdf.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(18).text(document.title, left, MARGIN);
  if (document.subtitle) {
    pdf
      .moveDown(0.2)
      .font('Helvetica')
      .fontSize(10)
      .fillColor(COLORS.muted)
      .text(document.subtitle);
  }
  pdf
    .moveDown(0.2)
    .font('Helvetica')
    .fontSize(9)
    .fillColor(COLORS.muted)
    .text(document.generatedLabel);
  pdf.moveDown(1);

  for (const table of document.tables) drawTable(table);

  // Footer on every page, once the page count is known.
  const range = pdf.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i += 1) {
    pdf.switchToPage(i);
    pdf
      .font('Helvetica')
      .fontSize(8)
      .fillColor(COLORS.muted)
      .text(
        document.pageLabel.replace('{page}', String(i + 1)).replace('{pages}', String(range.count)),
        left,
        pdf.page.height - MARGIN - 10,
        { width, align: 'right', lineBreak: false },
      );
  }
  pdf.end();
  return done;

  function drawTable(table: ReportTable): void {
    const weights = table.columns.map((column) => column.width ?? 1);
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    const widths = weights.map((weight) => (weight / total) * width);

    if (pdf.y + HEADER_HEIGHT * 3 > bottom()) pdf.addPage();
    if (table.title) {
      pdf.font('Helvetica-Bold').fontSize(12).fillColor(COLORS.ink).text(table.title, left, pdf.y);
      pdf.moveDown(0.4);
    }

    // Long labels ("Riesgo de merma") wrap: the header grows to the tallest one.
    pdf.font('Helvetica-Bold').fontSize(FONT_SIZE);
    const headerHeight = Math.max(
      HEADER_HEIGHT,
      ...table.columns.map(
        (column, index) =>
          pdf.heightOfString(column.label, { width: (widths[index] ?? 0) - 8 }) + 12,
      ),
    );

    const header = () => {
      const y = pdf.y;
      pdf.rect(left, y, width, headerHeight).fill(COLORS.header);
      let x = left;
      table.columns.forEach((column, index) => {
        pdf
          .font('Helvetica-Bold')
          .fontSize(FONT_SIZE)
          .fillColor(COLORS.headerText)
          .text(column.label, x + 4, y + 6, {
            width: (widths[index] ?? 0) - 8,
            align: column.kind === 'number' ? 'right' : 'left',
          });
        x += widths[index] ?? 0;
      });
      pdf.y = y + headerHeight;
    };

    if (table.rows.length === 0) {
      pdf
        .font('Helvetica-Oblique')
        .fontSize(10)
        .fillColor(COLORS.muted)
        .text(table.emptyText, left, pdf.y);
      pdf.moveDown(1);
    } else {
      header();
      table.rows.forEach((row, rowIndex) => {
        if (pdf.y + ROW_HEIGHT > bottom()) {
          pdf.addPage();
          pdf.y = MARGIN;
          header();
        }
        const y = pdf.y;
        if (rowIndex % 2 === 1) pdf.rect(left, y, width, ROW_HEIGHT).fill(COLORS.zebra);
        let x = left;
        row.forEach((cell, index) => {
          const column = table.columns[index];
          pdf
            .font('Helvetica')
            .fontSize(FONT_SIZE)
            .fillColor(COLORS.ink)
            .text(formatCell(cell, document.locale), x + 4, y + 5, {
              width: (widths[index] ?? 0) - 8,
              align: column?.kind === 'number' ? 'right' : 'left',
              lineBreak: false,
              ellipsis: true,
            });
          x += widths[index] ?? 0;
        });
        pdf.y = y + ROW_HEIGHT;
      });
      pdf
        .moveTo(left, pdf.y)
        .lineTo(left + width, pdf.y)
        .strokeColor(COLORS.rule)
        .stroke();
    }

    if (table.totals.length > 0) {
      if (pdf.y + table.totals.length * 14 + 10 > bottom()) {
        pdf.addPage();
        pdf.y = MARGIN;
      }
      pdf.moveDown(0.6);
      for (const item of table.totals) {
        pdf
          .font('Helvetica-Bold')
          .fontSize(9.5)
          .fillColor(COLORS.ink)
          .text(`${item.label}: `, left, pdf.y, { continued: true })
          .font('Helvetica')
          .text(item.value);
      }
    }
    pdf.moveDown(1.2);
  }
}

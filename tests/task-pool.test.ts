import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  generateBenchSnapshot,
  runHeavyAnalysis,
} from '../src/modules/benchmarks/domain/heavy-analysis.js';
import type { ReportDocument } from '../src/modules/reports/domain/report-document.js';
import {
  createLazyTaskPool,
  createTaskPool,
  TaskFailedError,
  type TaskPool,
} from '../src/workers/index.js';

// The real task-worker.ts, started like in development (--import tsx).
let pool: TaskPool;
beforeAll(() => {
  pool = createTaskPool({ size: 2, taskTimeoutMs: 20_000 });
});
afterAll(async () => {
  await pool.close();
});

const document: ReportDocument = {
  kind: 'inventory',
  locale: 'es',
  title: 'Inventario',
  generatedLabel: 'Generado el 28 oct 2026, 18:03 (Bogotá)',
  pageLabel: 'Página {page} de {pages}',
  tables: [
    {
      columns: [
        { label: 'Producto', kind: 'text' },
        { label: 'Disponible', kind: 'number' },
      ],
      rows: [['Piña', 12.5]],
      totals: [],
      emptyText: '',
    },
  ],
};

describe('heavyAnalysis', () => {
  it('is deterministic for a size and seed', () => {
    expect(JSON.stringify(generateBenchSnapshot(500, 7))).toBe(
      JSON.stringify(generateBenchSnapshot(500, 7)),
    );
    expect(runHeavyAnalysis(500, 7)).toEqual(runHeavyAnalysis(500, 7));
    expect(generateBenchSnapshot(3_000).orders).toHaveLength(3_000);
  });
});

describe('task pool (real task-worker)', { timeout: 30_000 }, () => {
  it('runs heavyAnalysis in a worker with the same result as the main thread', async () => {
    const inWorker = await pool.run('heavyAnalysis', { size: 1_000 });
    expect(inWorker).toEqual(runHeavyAnalysis(1_000));
    expect(inWorker.checksum).toBeGreaterThan(0);
  });

  it('builds the CSV and the PDF of a report in a worker', async () => {
    const [csv, pdf] = await Promise.all([
      pool.run('buildReport', { document, format: 'csv' }),
      pool.run('buildReport', { document, format: 'pdf' }),
    ]);
    expect(csv).toMatchObject({ contentType: 'text/csv; charset=utf-8', extension: 'csv' });
    expect([...csv.body.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(new TextDecoder().decode(csv.body)).toContain('Piña;12,5');
    expect(pdf.contentType).toBe('application/pdf');
    expect(Buffer.from(pdf.body).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('rejects an unknown task without killing the worker', async () => {
    await expect(
      (pool as unknown as { run: (t: string, p: unknown) => Promise<unknown> }).run('nope', {}),
    ).rejects.toBeInstanceOf(TaskFailedError);
    expect(pool.stats().restarts).toBe(0);
  });
});

describe('createLazyTaskPool', () => {
  it('starts no thread until the first task or warm()', async () => {
    const lazy = createLazyTaskPool({ size: 1 });
    expect(lazy.stats()).toEqual({ size: 1, ready: 0, busy: 0, queued: 0, restarts: 0 });
    lazy.warm();
    const until = Date.now() + 20_000;
    while (lazy.stats().ready < 1 && Date.now() < until)
      await new Promise((r) => setTimeout(r, 20));
    expect(lazy.stats().ready).toBe(1);
    await lazy.close();
  }, 30_000);
});

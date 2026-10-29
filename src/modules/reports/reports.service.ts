import { AUDIT_ACTIONS, type AuditService } from '../audit/index.js';
import {
  addDays,
  daysBetween,
  startOfDayIn,
  todayIn,
  type CalendarDate,
} from '../inventory/domain/index.js';
import type { InventoryMetricsService } from '../inventory/inventory-metrics.service.js';
import type { ProductRepository } from '../products/product.repository.js';
import type { Clock } from '../../shared/clock.js';
import { AppError } from '../../shared/errors/index.js';
import type { Actor } from '../../shared/http/actor.js';
import type { TaskPool } from '../../workers/index.js';
import type {
  ReportDocument,
  ReportFormat,
  ReportKind,
  ReportLocale,
} from './domain/report-document.js';
import {
  buildInventoryReport,
  buildOrdersReport,
  buildWasteReport,
  type ProductWithMetrics,
} from './report-builders.js';
import { REPORT_LABELS } from './report-labels.js';
import type { ReportsRepository } from './reports.repository.js';

/** Default range of the orders and waste reports: the last 30 days, today included. */
export const DEFAULT_RANGE_DAYS = 30;
/** A year at most: keeps the report (and the main-thread read) bounded. */
export const MAX_RANGE_DAYS = 366;

export interface ReportQuery {
  format: ReportFormat;
  locale: ReportLocale;
  from?: CalendarDate | undefined;
  to?: CalendarDate | undefined;
}

export interface GeneratedReport {
  filename: string;
  contentType: string;
  body: Buffer;
  rows: number;
  /** Database read (main thread), formatting (worker) and both. */
  timings: { readMs: number; renderMs: number; totalMs: number };
}

export interface ReportsService {
  generate(kind: ReportKind, query: ReportQuery, actor: Actor): Promise<GeneratedReport>;
}

export interface ReportsServiceDeps {
  reports: ReportsRepository;
  products: ProductRepository;
  metrics: InventoryMetricsService;
  pool: TaskPool;
  audit: AuditService;
  clock: Clock;
  timeZone: string;
  /** Milliseconds clock for the timings. */
  now?: () => number;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

export function createReportsService({
  reports,
  products,
  metrics,
  pool,
  audit,
  clock,
  timeZone,
  now = () => performance.now(),
}: ReportsServiceDeps): ReportsService {
  /** Validated range in business dates; `to` is inclusive. */
  function rangeOf(query: ReportQuery) {
    const today = todayIn(timeZone, clock());
    const to = query.to ?? today;
    const from = query.from ?? addDays(to, -(DEFAULT_RANGE_DAYS - 1));
    const days = daysBetween(from, to) + 1;
    if (days < 1) {
      throw new AppError(400, 'VALIDATION_ERROR', '`from` must not be after `to`', {
        field: 'from',
      });
    }
    if (days > MAX_RANGE_DAYS) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        `The range is limited to ${String(MAX_RANGE_DAYS)} days`,
        {
          field: 'to',
          maxDays: MAX_RANGE_DAYS,
        },
      );
    }
    return {
      from,
      to,
      fromInstant: startOfDayIn(from, timeZone),
      toInstant: startOfDayIn(addDays(to, 1), timeZone),
    };
  }

  async function productsWithMetrics(): Promise<ProductWithMetrics[]> {
    const { items } = await products.list({ status: 'ACTIVE' });
    const byProduct = await metrics.metricsFor(
      items.map((product) => ({ id: product.id, minStock: product.minStock.toNumber() })),
    );
    return items.flatMap((product) => {
      const productMetrics = byProduct.get(product.id);
      return productMetrics
        ? {
            name: product.name,
            category: product.category,
            unit: product.unit,
            minStock: product.minStock.toNumber(),
            metrics: productMetrics,
          }
        : [];
    });
  }

  /** Main thread: database reads only. */
  async function read(
    kind: ReportKind,
    query: ReportQuery,
  ): Promise<{ document: ReportDocument; suffix: string }> {
    const context = { locale: query.locale, generatedAt: clock(), timeZone };
    if (kind === 'inventory') {
      return {
        document: buildInventoryReport(await productsWithMetrics(), context),
        suffix: todayIn(timeZone, clock()),
      };
    }
    const range = rangeOf(query);
    const suffix = `${range.from}_${range.to}`;
    if (kind === 'orders') {
      const rows = await reports.ordersCreatedBetween(range.fromInstant, range.toInstant);
      return { document: buildOrdersReport(rows, range, context), suffix };
    }
    const [movements, catalog] = await Promise.all([
      reports.wasteBetween(range.fromInstant, range.toInstant),
      productsWithMetrics(),
    ]);
    return { document: buildWasteReport(movements, catalog, range, context), suffix };
  }

  return {
    async generate(kind, query, actor) {
      const started = now();
      const { document, suffix } = await read(kind, query);
      const read_ = now();
      // Formatting (CSV escaping, PDF layout) is CPU work: it runs in the worker pool.
      const rendered = await pool.run('buildReport', { document, format: query.format });
      const done = now();

      const rows = document.tables.reduce((sum, table) => sum + table.rows.length, 0);
      await audit.record({
        userId: actor.userId,
        action: AUDIT_ACTIONS.REPORT_EXPORTED,
        entity: 'Report',
        entityId: null,
        metadata: { kind, format: query.format, locale: query.locale, rows },
        ip: actor.ip,
      });
      return {
        filename: `alimentaiq-${REPORT_LABELS[query.locale][kind].file}-${suffix}.${rendered.extension}`,
        contentType: rendered.contentType,
        // A Uint8Array after crossing the thread boundary: view it as a Buffer without copying.
        body: Buffer.from(rendered.body.buffer, rendered.body.byteOffset, rendered.body.byteLength),
        rows,
        timings: {
          readMs: round1(read_ - started),
          renderMs: round1(done - read_),
          totalMs: round1(done - started),
        },
      };
    },
  };
}

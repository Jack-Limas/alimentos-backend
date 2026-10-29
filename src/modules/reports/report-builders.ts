import type { ProductCategory, Unit } from '@prisma/client';
import {
  fromDbDate,
  sumQty,
  type CalendarDate,
  type ProductMetrics,
} from '../inventory/domain/index.js';
import { formatOrderCode } from '../orders/domain/index.js';
import type { ReportDocument, ReportKind, ReportLocale } from './domain/report-document.js';
import { fill, REPORT_LABELS, type ReportLabels } from './report-labels.js';
import type { OrderReportRow, WasteMovementRow } from './reports.repository.js';

export interface ReportContext {
  locale: ReportLocale;
  generatedAt: Date;
  timeZone: string;
}

export interface ProductWithMetrics {
  name: string;
  category: ProductCategory;
  unit: Unit;
  minStock: number;
  metrics: ProductMetrics;
}

function header(kind: ReportKind, { locale, generatedAt, timeZone }: ReportContext) {
  const labels = REPORT_LABELS[locale];
  const date = new Intl.DateTimeFormat(locale === 'es' ? 'es-CO' : 'en-US', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone,
  }).format(generatedAt);
  return {
    labels,
    base: {
      kind,
      locale,
      title: labels[kind].title,
      generatedLabel: fill(labels.generated, { date }),
      pageLabel: labels.page,
    },
  };
}

/** "12,5 kg · 40 L": quantities of different units are never added together. */
function perUnit(
  rows: readonly { unit: Unit; quantity: number }[],
  labels: ReportLabels,
  locale: ReportLocale,
): string {
  const units = [...new Set(rows.map((row) => row.unit))].sort();
  const format = new Intl.NumberFormat(locale === 'es' ? 'es-CO' : 'en-US', {
    maximumFractionDigits: 3,
  });
  return (
    units
      .map((unit) => {
        const total = sumQty(rows.filter((row) => row.unit === unit).map((row) => row.quantity));
        return `${format.format(total)} ${labels.units[unit]}`;
      })
      .join(' · ') || '0'
  );
}

const day = (date: Date): CalendarDate => fromDbDate(date);

/** Active products with their metrics: stock, expiry and waste risk. */
export function buildInventoryReport(
  products: readonly ProductWithMetrics[],
  context: ReportContext,
): ReportDocument {
  const { labels, base } = header('inventory', context);
  const sorted = [...products].sort((a, b) => a.name.localeCompare(b.name, 'es'));
  return {
    ...base,
    tables: [
      {
        columns: labels.inventory.columns.map((label, index) => ({
          label,
          kind: [3, 4, 7, 8].includes(index) ? ('number' as const) : ('text' as const),
          width: index === 0 ? 2.4 : index === 1 ? 1.6 : 1,
        })),
        rows: sorted.map((p) => [
          p.name,
          labels.categories[p.category],
          labels.units[p.unit],
          p.metrics.availableQty,
          p.minStock,
          labels.stockStatus[p.metrics.stockStatus],
          p.metrics.nearestExpiry,
          p.metrics.daysToNearestExpiry,
          p.metrics.avgDailyOut30d,
          labels.wasteRisk[p.metrics.wasteRisk],
        ]),
        totals: [
          { label: labels.inventory.totals.products, value: String(sorted.length) },
          {
            label: labels.inventory.totals.available,
            value: perUnit(
              sorted.map((p) => ({ unit: p.unit, quantity: p.metrics.availableQty })),
              labels,
              context.locale,
            ),
          },
          {
            label: labels.inventory.totals.low,
            value: String(sorted.filter((p) => p.metrics.stockStatus === 'LOW').length),
          },
          {
            label: labels.inventory.totals.out,
            value: String(sorted.filter((p) => p.metrics.stockStatus === 'OUT').length),
          },
          {
            label: labels.inventory.totals.risk,
            value: String(sorted.filter((p) => p.metrics.wasteRisk === 'HIGH').length),
          },
        ],
        emptyText: labels.empty,
      },
    ],
  };
}

/** Orders created in the range, with a count per status. */
export function buildOrdersReport(
  orders: readonly OrderReportRow[],
  range: { from: CalendarDate; to: CalendarDate },
  context: ReportContext,
): ReportDocument {
  const { labels, base } = header('orders', context);
  const local = (date: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: context.timeZone }).format(date);
  const counts = new Map<string, number>();
  for (const order of orders) {
    counts.set(order.status, (counts.get(order.status) ?? 0) + 1);
  }
  return {
    ...base,
    subtitle: fill(labels.range, range),
    tables: [
      {
        columns: labels.orders.columns.map((label, index) => ({
          label,
          kind: index === 7 ? ('number' as const) : ('text' as const),
          width: index === 1 ? 2.6 : index === 4 ? 1.5 : 1,
        })),
        rows: orders.map((order) => [
          formatOrderCode(order.number),
          order.customerName,
          labels.customerTypes[order.customerType],
          labels.priorities[order.priority],
          labels.statuses[order.status],
          day(order.dueDate),
          local(order.createdAt),
          order.itemCount,
        ]),
        totals: [
          { label: labels.orders.totals.orders, value: String(orders.length) },
          {
            label: labels.orders.totals.byStatus,
            value:
              [...counts]
                .map(
                  ([status, count]) =>
                    `${labels.statuses[status as keyof ReportLabels['statuses']]}: ${String(count)}`,
                )
                .join(' · ') || '0',
          },
        ],
        emptyText: labels.empty,
      },
    ],
  };
}

/** EXIT_WASTE movements of the range and the products at high waste risk today. */
export function buildWasteReport(
  movements: readonly WasteMovementRow[],
  atRisk: readonly ProductWithMetrics[],
  range: { from: CalendarDate; to: CalendarDate },
  context: ReportContext,
): ReportDocument {
  const { labels, base } = header('waste', context);
  const local = (date: Date) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: context.timeZone }).format(date);
  const risky = atRisk
    .filter((p) => p.metrics.wasteRisk === 'HIGH')
    .sort(
      (a, b) =>
        (a.metrics.daysToNearestExpiry ?? 9_999) - (b.metrics.daysToNearestExpiry ?? 9_999) ||
        a.name.localeCompare(b.name, 'es'),
    );
  return {
    ...base,
    subtitle: fill(labels.range, range),
    tables: [
      {
        title: labels.waste.movementsTitle,
        columns: labels.waste.movementColumns.map((label, index) => ({
          label,
          kind: index === 4 ? ('number' as const) : ('text' as const),
          width: index === 1 || index === 6 ? 2.2 : 1,
        })),
        rows: movements.map((m) => [
          local(m.createdAt),
          m.productName,
          m.lotCode,
          day(m.expiryDate),
          m.quantity,
          labels.units[m.unit],
          m.reason,
        ]),
        totals: [
          { label: labels.waste.totals.movements, value: String(movements.length) },
          {
            label: labels.waste.totals.quantity,
            value: perUnit(movements, labels, context.locale),
          },
        ],
        emptyText: labels.empty,
      },
      {
        title: labels.waste.riskTitle,
        columns: labels.waste.riskColumns.map((label, index) => ({
          label,
          kind: [2, 5, 6].includes(index) ? ('number' as const) : ('text' as const),
          width: index === 0 ? 2.4 : index === 1 ? 1.6 : 1,
        })),
        rows: risky.map((p) => [
          p.name,
          labels.categories[p.category],
          p.metrics.availableQty,
          labels.units[p.unit],
          p.metrics.nearestExpiry,
          p.metrics.daysToNearestExpiry,
          p.metrics.avgDailyOut30d,
        ]),
        totals: [{ label: labels.waste.totals.products, value: String(risky.length) }],
        emptyText: labels.empty,
      },
    ],
  };
}

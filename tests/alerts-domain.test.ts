import { describe, expect, it } from 'vitest';
import { buildAlerts, type AlertProduct } from '../src/modules/alerts/domain/index.js';
import { addDays, productMetrics, type MetricsLot } from '../src/modules/inventory/domain/index.js';
import type { OrderStatus } from '../src/modules/orders/domain/index.js';

const TODAY = '2026-10-26';

function product(
  input: { minStock?: number; lots?: MetricsLot[]; outflow?: number; demand?: number },
  id = 'p1',
): AlertProduct {
  const minStock = input.minStock ?? 10;
  return {
    id,
    name: `Producto ${id}`,
    minStock,
    metrics: productMetrics({ minStock, lots: input.lots ?? [] }, input.outflow ?? 300, TODAY),
    pendingDemand: input.demand ?? 0,
  };
}

const lot = (quantity: number, daysLeft: number): MetricsLot => ({
  quantity,
  expiryDate: addDays(TODAY, daysLeft),
});

function alertsOf(p: AlertProduct) {
  return buildAlerts({ products: [p], orders: [], today: TODAY }).map((a) => [
    a.type,
    a.severity,
    a.code,
  ]);
}

describe('buildAlerts: products', () => {
  it('raises nothing for a healthy product', () => {
    expect(alertsOf(product({ lots: [lot(100, 60)] }))).toEqual([]);
  });

  it('LOW_STOCK is WARNING below the minimum, with availableQty and minStock', () => {
    const [alert] = buildAlerts({
      products: [product({ minStock: 10, lots: [lot(4, 60)] })],
      orders: [],
      today: TODAY,
    });
    expect(alert).toEqual({
      type: 'LOW_STOCK',
      severity: 'WARNING',
      entity: 'Product',
      entityId: 'p1',
      code: 'BELOW_MIN_STOCK',
      params: { name: 'Producto p1', availableQty: 4, minStock: 10 },
    });
  });

  it('LOW_STOCK is CRITICAL when out of stock (only expired stock counts as out)', () => {
    expect(alertsOf(product({ lots: [lot(50, -1)] }))).toEqual([
      ['LOW_STOCK', 'CRITICAL', 'OUT_OF_STOCK'],
    ]);
  });

  it.each([
    [7, 'WARNING'],
    [3, 'WARNING'],
    [2, 'CRITICAL'],
    [0, 'CRITICAL'],
  ])('EXPIRING_SOON for a lot expiring in %i days is %s', (days, severity) => {
    expect(alertsOf(product({ lots: [lot(20, days)] }))).toContainEqual([
      'EXPIRING_SOON',
      severity,
      'EXPIRES_IN_DAYS',
    ]);
  });

  it('raises no EXPIRING_SOON for a lot expiring in 8 days', () => {
    expect(alertsOf(product({ lots: [lot(20, 8)] }))).toEqual([]);
  });

  it('EXPIRING_SOON carries the days and the nearest expiry date', () => {
    const alert = buildAlerts({
      products: [product({ lots: [lot(20, 40), lot(5, 1)] })],
      orders: [],
      today: TODAY,
    }).find((a) => a.type === 'EXPIRING_SOON');
    expect(alert?.params).toMatchObject({ days: 1, expiryDate: '2026-10-27' });
  });

  it('WASTE_RISK is CRITICAL when coverage exceeds the days to expiry', () => {
    // 30 units dispatched in 30 days = 1/day; 50 units last 50 days, the lot expires in 20.
    const alerts = buildAlerts({
      products: [product({ lots: [lot(50, 20)], outflow: 30 })],
      orders: [],
      today: TODAY,
    });
    expect(alerts).toEqual([
      expect.objectContaining({
        type: 'WASTE_RISK',
        severity: 'CRITICAL',
        code: 'COVERAGE_EXCEEDS_EXPIRY',
        params: { name: 'Producto p1', coverageDays: 50, daysToExpiry: 20 },
      }),
    ]);
  });

  it('WASTE_RISK is CRITICAL without recent outflow and a lot expiring soon', () => {
    expect(alertsOf(product({ lots: [lot(20, 5)], outflow: 0 }))).toContainEqual([
      'WASTE_RISK',
      'CRITICAL',
      'NO_RECENT_OUTFLOW',
    ]);
  });

  it('raises no WASTE_RISK when the waste risk is only LOW', () => {
    const alerts = alertsOf(product({ lots: [lot(20, 5)], outflow: 300 }));
    expect(alerts.some(([type]) => type === 'WASTE_RISK')).toBe(false);
  });

  it('SHORTAGE_RISK is WARNING when pending demand exceeds available stock', () => {
    const alert = buildAlerts({
      products: [product({ lots: [lot(12.5, 60)], demand: 12.501 })],
      orders: [],
      today: TODAY,
    }).find((a) => a.type === 'SHORTAGE_RISK');
    expect(alert).toMatchObject({
      severity: 'WARNING',
      code: 'PENDING_DEMAND_EXCEEDS_STOCK',
      params: { demand: 12.501, available: 12.5 },
    });
  });

  it('raises no SHORTAGE_RISK when demand equals the stock', () => {
    expect(alertsOf(product({ lots: [lot(12.5, 60)], demand: 12.5 }))).toEqual([]);
  });

  it('raises SHORTAGE_RISK for an out-of-stock product with demand', () => {
    expect(alertsOf(product({ demand: 1 }))).toEqual([
      ['LOW_STOCK', 'CRITICAL', 'OUT_OF_STOCK'],
      ['SHORTAGE_RISK', 'WARNING', 'PENDING_DEMAND_EXCEEDS_STOCK'],
    ]);
  });
});

describe('buildAlerts: orders', () => {
  const order = (status: OrderStatus, daysLeft: number) => ({
    id: `o-${status}-${String(daysLeft)}`,
    number: 7,
    status,
    dueDate: addDays(TODAY, daysLeft),
  });
  const orderAlerts = (orders: ReturnType<typeof order>[]) =>
    buildAlerts({ products: [], orders, today: TODAY });

  it.each([0, 1, 2])('ORDER_DUE_SOON is WARNING for an open order due in %i days', (days) => {
    expect(orderAlerts([order('PENDING', days)])).toEqual([
      {
        type: 'ORDER_DUE_SOON',
        severity: 'WARNING',
        entity: 'Order',
        entityId: `o-PENDING-${String(days)}`,
        code: 'ORDER_DUE_IN_DAYS',
        params: { orderCode: 'PED-000007', days },
      },
    ]);
  });

  it('ORDER_DUE_SOON is CRITICAL when the due date has passed', () => {
    expect(orderAlerts([order('READY_FOR_DISPATCH', -3)])).toEqual([
      expect.objectContaining({
        severity: 'CRITICAL',
        code: 'ORDER_OVERDUE',
        params: { orderCode: 'PED-000007', daysOverdue: 3 },
      }),
    ]);
  });

  it('ignores orders due in 3 days or more', () => {
    expect(orderAlerts([order('PENDING', 3)])).toEqual([]);
  });

  it('ignores shipped, delivered and cancelled orders even when overdue', () => {
    expect(
      orderAlerts([order('SHIPPED', -1), order('DELIVERED', -1), order('CANCELLED', -1)]),
    ).toEqual([]);
  });
});

describe('buildAlerts: ordering', () => {
  it('sorts by severity, then type, then entity id', () => {
    const alerts = buildAlerts({
      products: [
        product({ minStock: 10, lots: [lot(4, 60)] }, 'b'),
        product({ minStock: 10, lots: [lot(4, 60)] }, 'a'),
        product({ lots: [] }, 'c'),
      ],
      orders: [{ id: 'o', number: 1, status: 'PENDING', dueDate: addDays(TODAY, -1) }],
      today: TODAY,
    });
    expect(alerts.map((a) => [a.severity, a.type, a.entityId])).toEqual([
      ['CRITICAL', 'LOW_STOCK', 'c'],
      ['CRITICAL', 'ORDER_DUE_SOON', 'o'],
      ['WARNING', 'LOW_STOCK', 'a'],
      ['WARNING', 'LOW_STOCK', 'b'],
    ]);
  });
});

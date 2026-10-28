import { describe, expect, it } from 'vitest';
import {
  MAX_AI_ITEMS,
  toBriefingInput,
  toExplanationInput,
  toRescuePlanInput,
  topPendingOrders,
  type PlanLine,
  type RescueCandidate,
} from '../src/modules/ai/ai-context.js';
import type { Alert } from '../src/modules/alerts/domain/index.js';
import type { ProductMetrics } from '../src/modules/inventory/domain/index.js';
import { lot, order, snapshot } from './helpers/distribution-fixtures.js';

const line = (overrides: Partial<PlanLine> = {}): PlanLine => ({
  orderItemId: 'item-1',
  orderCode: 'PED-000001',
  customerType: 'HOSPITAL',
  productName: 'Leche entera',
  requestedQty: 10,
  recommendedQty: 4,
  score: 80,
  reasons: [{ code: 'PRIORITY_URGENT', params: {} }],
  ...overrides,
});

describe('toExplanationInput', () => {
  it('adds up the lots of one item and keeps each reason once', () => {
    const input = toExplanationInput(
      [
        line({ reasons: [{ code: 'EXPIRES_IN_DAYS', params: { days: 2 } }] }),
        line({ recommendedQty: 3.5, reasons: [{ code: 'EXPIRES_IN_DAYS', params: { days: 9 } }] }),
        line({ orderItemId: 'item-2', productName: 'Pan', recommendedQty: 0 }),
      ],
      { locale: 'es', role: 'OPERATOR', strategy: 'AI_ASSISTED' },
    );

    expect(input.lines).toHaveLength(2);
    expect(input.lines[0]).toMatchObject({ product: 'Leche entera', recommendedQty: 7.5 });
    expect(input.lines[0]?.reasons).toEqual([{ code: 'EXPIRES_IN_DAYS', params: { days: 2 } }]);
  });

  it('never sends customer names, emails or phones', () => {
    const planLine = {
      ...line(),
      customerName: 'Hospital San José',
      email: 'compras@hospital.co',
      phone: '6015550101',
    };
    const json = JSON.stringify(
      toExplanationInput([planLine], { locale: 'es', role: 'ADMIN', strategy: 'BALANCED' }),
    );

    expect(json).not.toMatch(/San José|compras@|6015550101|customerName|email|phone/);
    expect(json).toContain('"customerType":"HOSPITAL"');
  });

  it('stops at the AI list limit and clips long names', () => {
    const lines = Array.from({ length: MAX_AI_ITEMS + 5 }, (_, i) =>
      line({ orderItemId: `item-${String(i)}`, productName: 'x'.repeat(300) }),
    );
    const input = toExplanationInput(lines, { locale: 'en', role: 'ADMIN', strategy: 'BALANCED' });

    expect(input.lines).toHaveLength(MAX_AI_ITEMS);
    expect(input.lines[0]?.product).toHaveLength(120);
  });
});

const metrics = (overrides: Partial<ProductMetrics>): ProductMetrics => ({
  availableQty: 20,
  expiredQty: 0,
  nearestExpiry: '2026-11-02',
  daysToNearestExpiry: 5,
  stockStatus: 'OK',
  avgDailyOut30d: 0.5,
  coverageDays: 40,
  wasteRisk: 'HIGH',
  reasons: [],
  ...overrides,
});

describe('toRescuePlanInput', () => {
  it('keeps only HIGH waste risk, nearest expiry first, and distinct customer types', () => {
    const candidates: RescueCandidate[] = [
      { name: 'Yogur', category: 'DAIRY', unit: 'L', metrics: metrics({ daysToNearestExpiry: 6 }) },
      {
        name: 'Arroz',
        category: 'GRAINS_LEGUMES',
        unit: 'KG',
        metrics: metrics({ wasteRisk: 'LOW' }),
      },
      {
        name: 'Mango',
        category: 'FRUITS_VEGETABLES',
        unit: 'KG',
        metrics: metrics({ daysToNearestExpiry: 2 }),
      },
      {
        name: 'Sin stock',
        category: 'DAIRY',
        unit: 'L',
        metrics: metrics({ daysToNearestExpiry: null }),
      },
    ];
    const input = toRescuePlanInput(candidates, ['SCHOOL', 'FOOD_BANK', 'SCHOOL'], 'es');

    expect(input.products.map((p) => p.name)).toEqual(['Mango', 'Yogur']);
    expect(input.products[0]).toEqual({
      name: 'Mango',
      category: 'FRUITS_VEGETABLES',
      qty: 20,
      unit: 'KG',
      daysToExpiry: 2,
      avgDailyOut: 0.5,
    });
    expect(input.customerTypes).toEqual(['FOOD_BANK', 'SCHOOL']);
  });
});

const alert = (type: Alert['type'], severity: Alert['severity'], code: Alert['code']): Alert => ({
  type,
  severity,
  code,
  entity: 'Product',
  entityId: 'p',
  params: { name: 'Leche' },
});

describe('toBriefingInput', () => {
  const alerts = [
    alert('LOW_STOCK', 'CRITICAL', 'OUT_OF_STOCK'),
    alert('LOW_STOCK', 'CRITICAL', 'OUT_OF_STOCK'),
    alert('WASTE_RISK', 'CRITICAL', 'COVERAGE_EXCEEDS_EXPIRY'),
    alert('LOW_STOCK', 'WARNING', 'BELOW_MIN_STOCK'),
  ];
  const kpis = {
    totalProducts: 56,
    lowStock: 1,
    outOfStock: 2,
    expiringSoon: 3,
    wasteRiskHigh: 1,
    pendingOrders: 9,
  };
  const pendingOrders = [
    {
      orderCode: 'PED-000003',
      priority: 'URGENT' as const,
      dueDate: '2026-10-29',
      customerType: 'HOSPITAL' as const,
    },
  ];

  it('sends counts by type and severity, never the alerts or product names', () => {
    const input = toBriefingInput({ locale: 'es', role: 'ADMIN', alerts, pendingOrders, kpis });

    expect(input.alerts).toEqual([
      { type: 'LOW_STOCK', severity: 'CRITICAL', code: 'OUT_OF_STOCK', params: { count: 2 } },
      {
        type: 'WASTE_RISK',
        severity: 'CRITICAL',
        code: 'COVERAGE_EXCEEDS_EXPIRY',
        params: { count: 1 },
      },
      { type: 'LOW_STOCK', severity: 'WARNING', code: 'BELOW_MIN_STOCK', params: { count: 1 } },
    ]);
    expect(JSON.stringify(input)).not.toContain('Leche');
    expect(input.kpis).toEqual(kpis);
    expect(input.pendingOrders[0]?.customerType).toBe('HOSPITAL');
  });

  it('gives the OPERATOR operational data only', () => {
    const input = toBriefingInput({ locale: 'es', role: 'OPERATOR', alerts, pendingOrders, kpis });

    expect(input.alerts.map((a) => a.type)).not.toContain('WASTE_RISK');
    expect(Object.keys(input.kpis).sort()).toEqual([
      'expiringSoon',
      'lowStock',
      'outOfStock',
      'pendingOrders',
    ]);
    expect(input.pendingOrders[0]).not.toHaveProperty('customerType');
  });
});

describe('topPendingOrders', () => {
  it('ranks by BALANCED score, then due date and number, and keeps the first ones', () => {
    const data = snapshot(
      [
        order(1, 'LOW', 12, [['rice', 1]]),
        order(2, 'URGENT', 0, [['rice', 1]]),
        order(3, 'URGENT', 0, [['rice', 1]]),
        order(4, 'HIGH', 3, [['rice', 1]]),
      ],
      [lot('l1', 'rice', 10, 20)],
    );
    const types = new Map([['order-2', 'SCHOOL' as const]]);

    const top = topPendingOrders(data, types, 3);

    expect(top.map((o) => o.orderCode)).toEqual(['PED-000002', 'PED-000003', 'PED-000004']);
    expect(top[0]).toEqual({
      orderCode: 'PED-000002',
      priority: 'URGENT',
      dueDate: data.orders[1]?.dueDate,
      customerType: 'SCHOOL',
    });
  });
});

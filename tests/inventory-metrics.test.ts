import { describe, expect, it } from 'vitest';
import {
  productMetrics,
  type MetricsLot,
} from '../src/modules/inventory/domain/product-metrics.js';

const today = '2026-10-26';
const in3 = '2026-10-29';
const in7 = '2026-11-02';
const in8 = '2026-11-03';
const in60 = '2026-12-25';
const yesterday = '2026-10-25';

const metrics = (minStock: number, lots: MetricsLot[], outflow30d = 0) =>
  productMetrics({ minStock, lots }, outflow30d, today);

describe('stockStatus', () => {
  it('is OUT with no stock at all', () => {
    const result = metrics(10, []);

    expect(result.stockStatus).toBe('OUT');
    expect(result.availableQty).toBe(0);
    expect(result.reasons).toContainEqual({ code: 'OUT_OF_STOCK', params: { minStock: 10 } });
  });

  it('is OUT when the only stock is expired (expired stock is not available)', () => {
    const result = metrics(10, [{ quantity: 40, expiryDate: yesterday }]);

    expect(result.stockStatus).toBe('OUT');
    expect(result.expiredQty).toBe(40);
    expect(result.reasons).toContainEqual({ code: 'EXPIRED_STOCK', params: { quantity: 40 } });
  });

  it('is OUT with zero stock even when minStock is 0', () => {
    expect(metrics(0, [{ quantity: 0, expiryDate: in60 }]).stockStatus).toBe('OUT');
  });

  it('is LOW below minStock', () => {
    const result = metrics(10, [{ quantity: 9.999, expiryDate: in60 }]);

    expect(result.stockStatus).toBe('LOW');
    expect(result.reasons).toContainEqual({
      code: 'BELOW_MIN_STOCK',
      params: { availableQty: 9.999, minStock: 10 },
    });
  });

  it('is OK exactly at minStock and above', () => {
    expect(metrics(10, [{ quantity: 10, expiryDate: in60 }]).stockStatus).toBe('OK');
    expect(metrics(10, [{ quantity: 25, expiryDate: in60 }]).stockStatus).toBe('OK');
  });

  it('sums every non-expired lot', () => {
    const result = metrics(5, [
      { quantity: 1.5, expiryDate: in3 },
      { quantity: 2.25, expiryDate: in60 },
      { quantity: 100, expiryDate: yesterday },
    ]);

    expect(result.availableQty).toBe(3.75);
    expect(result.nearestExpiry).toBe(in3);
    expect(result.daysToNearestExpiry).toBe(3);
  });
});

describe('outflow and coverage', () => {
  it('averages the 30-day dispatches per day', () => {
    const result = metrics(0, [{ quantity: 90, expiryDate: in60 }], 45);

    expect(result.avgDailyOut30d).toBe(1.5);
    expect(result.coverageDays).toBe(60);
  });

  it('has null coverage without outflow', () => {
    const result = metrics(0, [{ quantity: 90, expiryDate: in60 }], 0);

    expect(result.avgDailyOut30d).toBe(0);
    expect(result.coverageDays).toBeNull();
  });
});

describe('wasteRisk', () => {
  it('is HIGH without outflow when the nearest lot expires within 7 days', () => {
    const result = metrics(0, [{ quantity: 20, expiryDate: in7 }], 0);

    expect(result.wasteRisk).toBe('HIGH');
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        { code: 'EXPIRES_IN_DAYS', params: { days: 7 } },
        { code: 'NO_RECENT_OUTFLOW', params: { windowDays: 30 } },
      ]),
    );
  });

  it('is NONE without outflow when the nearest lot expires in more than 7 days', () => {
    expect(metrics(0, [{ quantity: 20, expiryDate: in8 }], 0).wasteRisk).toBe('NONE');
  });

  it('is HIGH when coverage exceeds the days to the nearest expiry (slow rotation)', () => {
    // 30 per 30 days = 1/day; 20 units last 20 days but the lot expires in 8.
    const result = metrics(0, [{ quantity: 20, expiryDate: in8 }], 30);

    expect(result.coverageDays).toBe(20);
    expect(result.wasteRisk).toBe('HIGH');
    expect(result.reasons).toContainEqual({
      code: 'COVERAGE_EXCEEDS_EXPIRY',
      params: { coverageDays: 20, daysToExpiry: 8 },
    });
  });

  it('is HIGH by coverage even when the expiry is far away', () => {
    // 0.1/day, 30 units last 300 days; expires in 60.
    expect(metrics(0, [{ quantity: 30, expiryDate: in60 }], 3).wasteRisk).toBe('HIGH');
  });

  it('is LOW when the lot expires within 7 days but rotation will clear it', () => {
    // 3/day, 6 units last 2 days, expires in 3.
    const result = metrics(0, [{ quantity: 6, expiryDate: in3 }], 90);

    expect(result.coverageDays).toBe(2);
    expect(result.wasteRisk).toBe('LOW');
    expect(result.reasons).toContainEqual({ code: 'EXPIRES_IN_DAYS', params: { days: 3 } });
  });

  it('is not HIGH when coverage equals the days to expiry', () => {
    // 1/day, 8 units last 8 days, expires in 8: sold just in time.
    expect(metrics(0, [{ quantity: 8, expiryDate: in8 }], 30).wasteRisk).toBe('NONE');
  });

  it('is NONE with healthy rotation and a distant expiry', () => {
    const result = metrics(10, [{ quantity: 40, expiryDate: in60 }], 60);

    expect(result.wasteRisk).toBe('NONE');
    expect(result.reasons).toEqual([]);
  });

  it('is NONE without non-expired stock, even if expired stock remains', () => {
    const result = metrics(0, [{ quantity: 40, expiryDate: yesterday }], 0);

    expect(result.wasteRisk).toBe('NONE');
    expect(result.nearestExpiry).toBeNull();
  });

  it('counts a lot expiring today as 0 days away and at risk', () => {
    const result = metrics(0, [{ quantity: 5, expiryDate: today }], 30);

    expect(result.daysToNearestExpiry).toBe(0);
    expect(result.wasteRisk).toBe('HIGH');
  });
});

describe('custom thresholds', () => {
  it('uses the rules object instead of the defaults', () => {
    const result = productMetrics(
      { minStock: 0, lots: [{ quantity: 20, expiryDate: in8 }] },
      0,
      today,
      { EXPIRY_WARNING_DAYS: 10, OUTFLOW_WINDOW_DAYS: 30 },
    );

    expect(result.wasteRisk).toBe('HIGH');
  });
});

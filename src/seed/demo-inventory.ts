import { randomUUID } from 'node:crypto';
import type { Unit } from '@prisma/client';
import { addDays, type CalendarDate } from '../modules/inventory/domain/index.js';
import type { CatalogItem } from './catalog.js';
import { createRandom, type Random } from './random.js';

export interface DemoLot {
  id: string;
  productId: string;
  lotCode: string;
  quantity: number;
  initialQuantity: number;
  expiryDate: CalendarDate;
  receivedAt: Date;
}

export interface DemoMovement {
  id: string;
  lotId: string;
  type: 'ENTRY' | 'EXIT_DISPATCH';
  quantity: number;
  reason: string;
  userId: string;
  createdAt: Date;
}

export interface DemoInventoryInput {
  products: readonly { id: string; item: CatalogItem }[];
  /** Business date in APP_TIMEZONE; every date is relative to it. */
  today: CalendarDate;
  /** User recorded on the movements (the seeded admin). */
  userId: string;
  seed?: number;
  newId?: () => string;
}

/** Dispatch history covers days 1..29 before today, inside the 30-day window. */
const HISTORY_DAYS = 29;
const RECEIVED_REASON = 'Recepción (datos demo)';
const DISPATCH_REASON = 'Despacho (datos demo)';

/** Countable units are whole; weights and volumes keep one decimal. */
function roundFor(unit: Unit, value: number): number {
  return unit === 'UNIT' || unit === 'BOX'
    ? Math.max(1, Math.round(value))
    : Math.max(0.1, Math.round(value * 10) / 10);
}

/** 07:00 in Bogota (12:00 UTC) of a calendar date, plus some minutes. */
function at(date: CalendarDate, hourUtc: number, minutes = 0): Date {
  const instant = new Date(`${date}T${String(hourUtc).padStart(2, '0')}:00:00.000Z`);
  return new Date(instant.getTime() + minutes * 60_000);
}

function lotCode(received: CalendarDate, index: number): string {
  return `L-${received.slice(2).replaceAll('-', '')}-${String(index).padStart(2, '0')}`;
}

/**
 * Builds a consistent demo inventory relative to `today`:
 * - Dispatch history: lots received over the last 29 days, each fully
 *   dispatched before it expired (quantity 0), with EXIT_DISPATCH movements.
 *   This is what gives every product its 30-day rotation.
 * - Current stock: 1 to 3 lots per product shaped by its scenario (none for
 *   OUT), each with its ENTRY movement.
 * Pure apart from ids: the same seed gives the same quantities and dates.
 */
export function buildDemoInventory({
  products,
  today,
  userId,
  seed = 2026,
  newId = randomUUID,
}: DemoInventoryInput): { lots: DemoLot[]; movements: DemoMovement[] } {
  const lots: DemoLot[] = [];
  const movements: DemoMovement[] = [];

  products.forEach(({ id: productId, item }, productIndex) => {
    const random = createRandom(seed + productIndex * 7919);
    let codeIndex = 1;

    const addLot = (
      received: CalendarDate,
      expiry: CalendarDate,
      quantity: number,
      initial = quantity,
    ) => {
      const lot: DemoLot = {
        id: newId(),
        productId,
        lotCode: lotCode(received, codeIndex++),
        quantity,
        initialQuantity: initial,
        expiryDate: expiry,
        receivedAt: at(received, 12),
      };
      lots.push(lot);
      movements.push({
        id: newId(),
        lotId: lot.id,
        type: 'ENTRY',
        quantity: initial,
        reason: RECEIVED_REASON,
        userId,
        createdAt: lot.receivedAt,
      });
      return lot;
    };

    buildHistory(item, today, random, (received, expiry, dispatches) => {
      const total = dispatches.reduce((sum, d) => sum + Math.round(d.quantity * 1000), 0) / 1000;
      if (total === 0) return;
      const lot = addLot(received, expiry, 0, total);
      for (const dispatch of dispatches) {
        movements.push({
          id: newId(),
          lotId: lot.id,
          type: 'EXIT_DISPATCH',
          quantity: dispatch.quantity,
          reason: DISPATCH_REASON,
          userId,
          createdAt: dispatch.at,
        });
      }
    });

    for (const lot of currentLots(item, today, random)) {
      addLot(lot.received, lot.expiry, lot.quantity);
    }
  });

  return { lots, movements };
}

type HistorySink = (
  received: CalendarDate,
  expiry: CalendarDate,
  dispatches: { quantity: number; at: Date }[],
) => void;

/** Splits the last 29 days into receptions shorter than the shelf life. */
function buildHistory(item: CatalogItem, today: CalendarDate, random: Random, sink: HistorySink) {
  if (item.dailyOut <= 0) return;
  const chunk = Math.max(1, Math.min(10, item.shelfLifeDays - 1));
  for (let start = HISTORY_DAYS; start >= 1; start -= chunk) {
    const received = addDays(today, -start);
    const dispatches: { quantity: number; at: Date }[] = [];
    for (let daysAgo = start; daysAgo > Math.max(0, start - chunk); daysAgo -= 1) {
      if (random.next() < 0.15) continue; // some days without dispatch
      dispatches.push({
        quantity: roundFor(item.unit, item.dailyOut * random.between(0.6, 1.4)),
        at: at(addDays(today, -daysAgo), 15, random.int(0, 360)),
      });
    }
    sink(received, addDays(received, item.shelfLifeDays), dispatches);
  }
}

interface PlannedLot {
  received: CalendarDate;
  expiry: CalendarDate;
  quantity: number;
}

/** Received `daysAgo` days ago (at least yesterday) and expiring `daysLeft` days from today. */
function planned(
  today: CalendarDate,
  daysAgo: number,
  daysLeft: number,
  quantity: number,
): PlannedLot {
  return {
    received: addDays(today, -Math.max(1, daysAgo)),
    expiry: addDays(today, daysLeft),
    quantity,
  };
}

/** Days left for a fresh lot of this shelf life, received 1 to 3 days ago. */
function freshDaysLeft(item: CatalogItem, random: Random): { daysAgo: number; daysLeft: number } {
  const daysAgo = random.int(1, Math.min(3, Math.max(1, item.shelfLifeDays - 8)));
  return { daysAgo, daysLeft: item.shelfLifeDays - daysAgo };
}

/** Splits a total into 1 to 3 lots with staggered expiries. */
function splitIntoLots(item: CatalogItem, today: CalendarDate, random: Random, total: number) {
  const count = item.shelfLifeDays >= 60 ? random.int(1, 3) : random.int(1, 2);
  const lots: PlannedLot[] = [];
  let left = total;
  for (let index = 0; index < count; index += 1) {
    const share =
      index === count - 1 ? left : roundFor(item.unit, total * random.between(0.3, 0.6));
    left = Math.max(0, roundFor(item.unit, left - share));
    const { daysAgo, daysLeft } = freshDaysLeft(item, random);
    // Older lots of long shelf-life products expire sooner.
    const extraAge = item.shelfLifeDays >= 60 ? index * random.int(5, 30) : 0;
    lots.push(planned(today, daysAgo + extraAge, daysLeft - extraAge + index * 2, share));
    if (left <= 0) break;
  }
  return lots;
}

function currentLots(item: CatalogItem, today: CalendarDate, random: Random): PlannedLot[] {
  const { minStock, dailyOut, unit } = item;

  switch (item.scenario) {
    case 'OUT':
      return [];

    case 'LOW':
      return splitIntoLots(
        item,
        today,
        random,
        roundFor(unit, minStock * random.between(0.3, 0.75)),
      );

    case 'EXPIRING': {
      // One lot that sells out just before it expires: waste risk LOW, not HIGH.
      const daysLeft = random.int(2, 6);
      const quantity = roundFor(unit, dailyOut * daysLeft * random.between(0.4, 0.7));
      return [planned(today, item.shelfLifeDays - daysLeft, daysLeft, quantity)];
    }

    case 'EXPIRED': {
      const expiredDaysAgo = random.int(1, 3);
      const leftover = roundFor(
        unit,
        Math.max(minStock * 0.1, dailyOut * random.between(0.3, 0.8)),
      );
      const { daysAgo, daysLeft } = freshDaysLeft(item, random);
      const fresh = roundFor(
        unit,
        Math.min(minStock * random.between(1.1, 1.6), dailyOut * Math.max(1, daysLeft - 1)),
      );
      return [
        planned(today, item.shelfLifeDays + expiredDaysAgo, -expiredDaysAgo, leftover),
        planned(today, daysAgo, daysLeft, fresh),
      ];
    }

    case 'WASTE': {
      // Slow rotation: the stock lasts longer than the days left before it expires.
      const daysLeft = Math.min(item.shelfLifeDays - 1, random.int(8, 14));
      const quantity = roundFor(
        unit,
        Math.max(minStock * 1.5, dailyOut * daysLeft * random.between(1.6, 2.4)),
      );
      return [planned(today, item.shelfLifeDays - daysLeft, daysLeft, quantity)];
    }

    case 'IDLE': {
      const quantity = roundFor(unit, minStock * random.between(1.2, 2));
      // Perishable idle stock is close to expiry (high waste risk); shelf-stable is not.
      const daysLeft =
        item.shelfLifeDays <= 30 ? random.int(3, 6) : item.shelfLifeDays - random.int(20, 60);
      return [planned(today, item.shelfLifeDays - daysLeft, daysLeft, quantity)];
    }

    case 'HEALTHY': {
      const { daysLeft } = freshDaysLeft(item, random);
      // Enough for the minimum, but never more than sells before the nearest expiry.
      const cap = dailyOut > 0 ? dailyOut * Math.max(1, daysLeft - 2) * 0.9 : Infinity;
      const total = roundFor(unit, Math.min(minStock * random.between(1.3, 2.5), cap));
      return splitIntoLots(item, today, random, Math.max(total, minStock));
    }
  }
}

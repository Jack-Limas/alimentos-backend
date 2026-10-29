import type { CustomerType, Unit } from '@prisma/client';
import {
  addDays,
  daysBetween,
  fromDbDate,
  fromMilli,
  INVENTORY_RULES,
  todayIn,
  toMilli,
  type CalendarDate,
} from '../../inventory/domain/index.js';

export const IMPACT_WINDOW_DAYS = 30;
/** "Rescued": dispatched from a lot that was this close to expiring (the alert threshold). */
export const RESCUE_DAYS = INVENTORY_RULES.EXPIRY_WARNING_DAYS;

export interface ImpactDispatch {
  createdAt: Date;
  unit: Unit;
  quantity: number;
  /** Lot expiry, @db.Date midnight UTC. */
  expiryDate: Date;
}

export interface ImpactDelivery {
  customerId: string;
  customerType: CustomerType;
  deliveredAt: Date;
  /** @db.Date midnight UTC. */
  dueDate: Date;
}

/** Aggregates only: no names, no ids, nothing that identifies a person or a customer. */
export interface Impact {
  windowDays: number;
  from: CalendarDate;
  to: CalendarDate;
  /** Quantity dispatched per unit (units are never added together). */
  dispatched: Partial<Record<Unit, number>>;
  /** Of it, dispatched from lots at most RESCUE_DAYS from expiry. */
  rescued: Partial<Record<Unit, number>>;
  rescueDays: number;
  deliveries: { total: number; onTime: number; onTimePct: number | null };
  customersServed: { total: number; byType: Partial<Record<CustomerType, number>> };
  generatedAt: string;
}

function addTo(totals: Map<Unit, number>, unit: Unit, quantity: number): void {
  totals.set(unit, (totals.get(unit) ?? 0) + toMilli(quantity));
}

function perUnit(totals: Map<Unit, number>): Partial<Record<Unit, number>> {
  return Object.fromEntries(
    [...totals]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([unit, milli]) => [unit, fromMilli(milli)]),
  );
}

/**
 * Impact of the last IMPACT_WINDOW_DAYS for the public page. Days are counted
 * in the business time zone: a dispatch "rescues" stock when its lot expires
 * within RESCUE_DAYS of the dispatch day; a delivery is on time when it
 * happened on or before the due date.
 */
export function computeImpact({
  dispatches,
  deliveries,
  now,
  timeZone,
}: {
  dispatches: readonly ImpactDispatch[];
  deliveries: readonly ImpactDelivery[];
  now: Date;
  timeZone: string;
}): Impact {
  const to = todayIn(timeZone, now);
  const dispatched = new Map<Unit, number>();
  const rescued = new Map<Unit, number>();
  for (const dispatch of dispatches) {
    addTo(dispatched, dispatch.unit, dispatch.quantity);
    const daysLeft = daysBetween(
      todayIn(timeZone, dispatch.createdAt),
      fromDbDate(dispatch.expiryDate),
    );
    if (daysLeft <= RESCUE_DAYS) addTo(rescued, dispatch.unit, dispatch.quantity);
  }

  const onTime = deliveries.filter(
    (delivery) => todayIn(timeZone, delivery.deliveredAt) <= fromDbDate(delivery.dueDate),
  ).length;
  const customers = new Map<string, CustomerType>();
  for (const delivery of deliveries) customers.set(delivery.customerId, delivery.customerType);
  const byType: Partial<Record<CustomerType, number>> = {};
  for (const type of customers.values()) byType[type] = (byType[type] ?? 0) + 1;

  return {
    windowDays: IMPACT_WINDOW_DAYS,
    from: addDays(to, -(IMPACT_WINDOW_DAYS - 1)),
    to,
    dispatched: perUnit(dispatched),
    rescued: perUnit(rescued),
    rescueDays: RESCUE_DAYS,
    deliveries: {
      total: deliveries.length,
      onTime,
      onTimePct:
        deliveries.length === 0 ? null : Math.round((onTime / deliveries.length) * 1000) / 10,
    },
    customersServed: {
      total: customers.size,
      byType: Object.fromEntries(Object.entries(byType).sort(([a], [b]) => (a < b ? -1 : 1))),
    },
    generatedAt: now.toISOString(),
  };
}

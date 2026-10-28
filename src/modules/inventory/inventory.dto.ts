import type { MovementType, Unit } from '@prisma/client';
import { daysBetween, fromDbDate, type CalendarDate } from './domain/index.js';
import type { LotRecord, MovementListRecord, MovementRecord } from './inventory.repository.js';

export interface LotDto {
  id: string;
  productId: string;
  lotCode: string | null;
  quantity: number;
  initialQuantity: number;
  /** YYYY-MM-DD */
  expiryDate: CalendarDate;
  receivedAt: string;
  daysToExpiry: number;
  expired: boolean;
}

export interface MovementDto {
  id: string;
  lotId: string;
  productId: string;
  type: MovementType;
  /** Always positive; the type gives the direction. */
  quantity: number;
  reason: string | null;
  orderId: string | null;
  userId: string;
  createdAt: string;
}

/** Decimals leave the API as JSON numbers (contract, section 3). */
export function toLotDto(lot: LotRecord, today: CalendarDate): LotDto {
  const expiryDate = fromDbDate(lot.expiryDate);
  const daysToExpiry = daysBetween(today, expiryDate);
  return {
    id: lot.id,
    productId: lot.productId,
    lotCode: lot.lotCode,
    quantity: lot.quantity.toNumber(),
    initialQuantity: lot.initialQuantity.toNumber(),
    expiryDate,
    receivedAt: lot.receivedAt.toISOString(),
    daysToExpiry,
    expired: daysToExpiry < 0,
  };
}

/** A movement of the log, with its product name and unit. */
export interface MovementListDto extends MovementDto {
  productName: string;
  unit: Unit;
}

export function toMovementListDto(movement: MovementListRecord): MovementListDto {
  return { ...toMovementDto(movement), productName: movement.productName, unit: movement.unit };
}

export function toMovementDto(movement: MovementRecord): MovementDto {
  return {
    id: movement.id,
    lotId: movement.lotId,
    productId: movement.productId,
    type: movement.type,
    quantity: movement.quantity.toNumber(),
    reason: movement.reason,
    orderId: movement.orderId,
    userId: movement.userId,
    createdAt: movement.createdAt.toISOString(),
  };
}

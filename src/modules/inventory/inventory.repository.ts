import type { MovementType, Prisma, Unit } from '@prisma/client';
import type { NewAuditLog } from '../audit/index.js';

export interface LotRecord {
  id: string;
  productId: string;
  lotCode: string | null;
  quantity: Prisma.Decimal;
  initialQuantity: Prisma.Decimal;
  /** @db.Date, read as midnight UTC. */
  expiryDate: Date;
  receivedAt: Date;
  createdAt: Date;
}

export interface MovementRecord {
  id: string;
  lotId: string;
  /** Product of the lot, joined for convenience. */
  productId: string;
  type: MovementType;
  quantity: Prisma.Decimal;
  reason: string | null;
  orderId: string | null;
  userId: string;
  createdAt: Date;
}

/** A movement with the name and unit of its product, for the movement log. */
export interface MovementListRecord extends MovementRecord {
  productName: string;
  unit: Unit;
}

/** Remaining stock per product and expiry date (only rows with stock). */
export interface StockByExpiryRow {
  productId: string;
  expiryDate: Date;
  quantity: Prisma.Decimal;
}

/** Total EXIT_DISPATCH per product inside a time window. */
export interface OutflowRow {
  productId: string;
  quantity: Prisma.Decimal;
}

export interface LotFilter {
  productId?: string | undefined;
  /** Inclusive lower bound on expiryDate (e.g. today, to hide expired lots). */
  expiryFrom?: Date | undefined;
  /** Inclusive upper bound on expiryDate. */
  expiryTo?: Date | undefined;
}

export interface MovementFilter {
  productId?: string | undefined;
  type?: MovementType | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
}

export interface NewEntry {
  lot: {
    id: string;
    productId: string;
    lotCode: string | null;
    quantity: number;
    expiryDate: Date;
  };
  movement: { id: string; reason: string | null; userId: string };
  audit: NewAuditLog;
}

export interface NewExits {
  type: MovementType;
  reason: string | null;
  userId: string;
  allocations: { movementId: string; lotId: string; qty: number }[];
  audit: NewAuditLog;
}

/**
 * A lot no longer had the quantity to take when the exit was written (another
 * exit won the race). Nothing of that exit was stored.
 */
export class InsufficientStockError extends Error {
  constructor(public readonly lotId: string) {
    super('The lot does not have enough stock');
    this.name = 'InsufficientStockError';
  }
}

export interface InventoryRepository {
  stockByExpiry(productIds?: readonly string[]): Promise<StockByExpiryRow[]>;
  dispatchedSince(since: Date, productIds?: readonly string[]): Promise<OutflowRow[]>;
  findLot(id: string): Promise<LotRecord | null>;
  /** Lots of a product that still have stock, ordered by expiry date. */
  lotsWithStock(productId: string): Promise<LotRecord[]>;
  /** Lots with stock, ordered by expiry date. */
  listLots(
    filter: LotFilter,
    page: { skip: number; take: number },
  ): Promise<{ items: LotRecord[]; total: number }>;
  /** Newest first. */
  listMovements(
    filter: MovementFilter,
    page: { skip: number; take: number },
  ): Promise<{ items: MovementListRecord[]; total: number }>;
  /** Lot + ENTRY movement + audit row in one transaction. */
  createEntry(entry: NewEntry): Promise<{ lot: LotRecord; movement: MovementRecord }>;
  /**
   * Decrements every allocated lot and writes the movements and the audit row
   * in one transaction. Each lot is decremented only if it still has the
   * quantity; otherwise everything rolls back with InsufficientStockError.
   */
  applyExits(exits: NewExits): Promise<MovementRecord[]>;
}

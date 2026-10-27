import type {
  CustomerType,
  MovementType,
  OrderPriority,
  OrderStatus,
  Prisma,
  ProductStatus,
  Unit,
} from '@prisma/client';
import type { NewAuditLog } from '../audit/index.js';

export interface OrderRecord {
  id: string;
  /** Sequential; the DTO derives the "PED-000123" code from it. */
  number: number;
  customerId: string;
  status: OrderStatus;
  priority: OrderPriority;
  /** @db.Date, read as midnight UTC. */
  dueDate: Date;
  notes: string | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
}

/** An order with what a listing shows. */
export interface OrderSummaryRecord extends OrderRecord {
  customer: { id: string; name: string; type: CustomerType };
  itemCount: number;
}

export interface OrderItemRecord {
  id: string;
  productId: string;
  product: { name: string; unit: Unit };
  requestedQty: Prisma.Decimal;
  allocatedQty: Prisma.Decimal;
}

export interface OrderHistoryRecord {
  id: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  userId: string;
  note: string | null;
  createdAt: Date;
}

export interface OrderDetailRecord extends OrderSummaryRecord {
  /** Ordered by product name. */
  items: OrderItemRecord[];
  /** Oldest first. */
  history: OrderHistoryRecord[];
}

export interface OrderFilter {
  /** Any of these statuses. */
  statuses?: OrderStatus[] | undefined;
  priority?: OrderPriority | undefined;
  customerId?: string | undefined;
  /** Exclusive upper bound on dueDate. */
  dueBefore?: Date | undefined;
}

export interface NewOrder {
  id: string;
  customerId: string;
  priority: OrderPriority;
  dueDate: Date;
  notes: string | null;
  createdById: string;
  items: { id: string; productId: string; requestedQty: number }[];
  /** The first history row, null -> PENDING. */
  historyId: string;
  audit: NewAuditLog;
}

export interface StatusChange {
  orderId: string;
  /** The status the service read; the update only applies while it is still current. */
  from: OrderStatus;
  to: OrderStatus;
  userId: string;
  note: string | null;
  historyId: string;
  /** RETURN movements to write and give back to their lots (cancellations). */
  returns: { movementId: string; lotId: string; qty: number }[];
  /** Sets allocatedQty of every item back to 0 (cancellations). */
  resetAllocations: boolean;
  audit: NewAuditLog;
}

/** Stock movement caused by an order. */
export interface OrderMovementRecord {
  lotId: string;
  type: MovementType;
  quantity: Prisma.Decimal;
}

/** Requested quantity per product over the PENDING orders. */
export interface DemandRow {
  productId: string;
  quantity: Prisma.Decimal;
}

/**
 * The order was no longer in the status the service read: another user changed
 * it first. Nothing of the change was stored.
 */
export class OrderStatusConflictError extends Error {
  constructor(public readonly orderId: string) {
    super('The order status was changed by another request');
    this.name = 'OrderStatusConflictError';
  }
}

export interface OrderRepository {
  findById(id: string): Promise<OrderRecord | null>;
  findDetail(id: string): Promise<OrderDetailRecord | null>;
  /** Ordered by dueDate, then priority (URGENT first), then number. */
  list(
    filter: OrderFilter,
    page: { skip: number; take: number },
  ): Promise<{ items: OrderSummaryRecord[]; total: number }>;
  /** Status of the given products, in one query (missing ids are left out). */
  productStatuses(ids: readonly string[]): Promise<{ id: string; status: ProductStatus }[]>;
  /** Order + items + first history row + audit row in one transaction. */
  create(order: NewOrder): Promise<OrderRecord>;
  movementsOf(orderId: string): Promise<OrderMovementRecord[]>;
  /**
   * Conditional status update, returns, allocation reset, history and audit in
   * one transaction. Throws OrderStatusConflictError, rolling everything back,
   * when the order is no longer in `from`.
   */
  changeStatus(change: StatusChange): Promise<OrderRecord>;
  /** One grouped query over every PENDING order. */
  pendingDemand(): Promise<DemandRow[]>;
  /** Orders not shipped yet whose dueDate is on or before `date`. */
  openOrdersDueBy(date: Date): Promise<OrderRecord[]>;
}

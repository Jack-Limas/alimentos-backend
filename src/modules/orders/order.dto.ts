import type { CustomerType, OrderPriority, OrderStatus, Unit } from '@prisma/client';
import { fromDbDate } from '../inventory/domain/index.js';
import { formatOrderCode } from './domain/index.js';
import type {
  OrderDetailRecord,
  OrderHistoryRecord,
  OrderItemRecord,
  OrderSummaryRecord,
} from './order.repository.js';

export interface OrderDto {
  id: string;
  /** "PED-000123". */
  code: string;
  number: number;
  customer: { id: string; name: string; type: CustomerType };
  status: OrderStatus;
  priority: OrderPriority;
  /** YYYY-MM-DD. */
  dueDate: string;
  notes: string | null;
  itemCount: number;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrderItemDto {
  id: string;
  productId: string;
  productName: string;
  unit: Unit;
  requestedQty: number;
  allocatedQty: number;
}

export interface OrderHistoryDto {
  id: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  userId: string;
  note: string | null;
  createdAt: string;
}

export interface OrderDetailDto extends OrderDto {
  items: OrderItemDto[];
  history: OrderHistoryDto[];
}

export function toOrderDto(order: OrderSummaryRecord): OrderDto {
  return {
    id: order.id,
    code: formatOrderCode(order.number),
    number: order.number,
    customer: order.customer,
    status: order.status,
    priority: order.priority,
    dueDate: fromDbDate(order.dueDate),
    notes: order.notes,
    itemCount: order.itemCount,
    createdById: order.createdById,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

function toItemDto(item: OrderItemRecord): OrderItemDto {
  return {
    id: item.id,
    productId: item.productId,
    productName: item.product.name,
    unit: item.product.unit,
    requestedQty: item.requestedQty.toNumber(),
    allocatedQty: item.allocatedQty.toNumber(),
  };
}

function toHistoryDto(entry: OrderHistoryRecord): OrderHistoryDto {
  return { ...entry, createdAt: entry.createdAt.toISOString() };
}

export function toOrderDetailDto(order: OrderDetailRecord): OrderDetailDto {
  return {
    ...toOrderDto(order),
    items: order.items.map(toItemDto),
    history: order.history.map(toHistoryDto),
  };
}

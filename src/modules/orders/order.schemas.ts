import { OrderPriority, OrderStatus } from '@prisma/client';
import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/http/pagination.js';
import { calendarDateSchema, positiveQuantitySchema } from '../inventory/inventory.schemas.js';

export const MAX_ORDER_ITEMS = 50;

export const orderIdParamsSchema = z.object({ id: z.uuid() });

/** `?status=PENDING,IN_PREPARATION` or `?status=PENDING&status=IN_PREPARATION`. */
const statusList = z.preprocess(
  (value: unknown): unknown[] =>
    (Array.isArray(value) ? (value as unknown[]) : [value]).flatMap((part): unknown[] =>
      typeof part === 'string' ? part.split(',').map((s) => s.trim()) : [part],
    ),
  z.array(z.enum(OrderStatus)).min(1),
);

export const orderListQuerySchema = paginationQuerySchema.extend({
  status: statusList.optional(),
  priority: z.enum(OrderPriority).optional(),
  customerId: z.uuid().optional(),
  /** Orders due strictly before this date. */
  dueBefore: calendarDateSchema.optional(),
});

// strictObject: unknown fields (e.g. an allocatedQty sent by the client) are a 400.
const orderItemSchema = z.strictObject({
  productId: z.uuid(),
  quantity: positiveQuantitySchema,
});

export const createOrderSchema = z.strictObject({
  customerId: z.uuid(),
  priority: z.enum(OrderPriority),
  dueDate: calendarDateSchema,
  notes: z.string().trim().min(1).max(500).optional(),
  items: z
    .array(orderItemSchema)
    .min(1)
    .max(MAX_ORDER_ITEMS)
    .refine((items) => new Set(items.map((item) => item.productId)).size === items.length, {
      message: 'each product can appear only once',
    }),
});

export const changeStatusSchema = z.strictObject({
  status: z.enum(OrderStatus),
  note: z.string().trim().min(1).max(500).optional(),
});

export type OrderListQuery = z.infer<typeof orderListQuerySchema>;
export type CreateOrderBody = z.infer<typeof createOrderSchema>;
export type ChangeStatusBody = z.infer<typeof changeStatusSchema>;

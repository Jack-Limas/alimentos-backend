import { randomUUID } from 'node:crypto';
import type { Role } from '@prisma/client';
import { AUDIT_ACTIONS, buildAuditEntry } from '../audit/index.js';
import type { CustomerRepository } from '../customers/customer.repository.js';
import { daysBetween, toDbDate, type CalendarDate } from '../inventory/domain/index.js';
import { AppError } from '../../shared/errors/index.js';
import type { Actor } from '../../shared/http/actor.js';
import { paginate, toSkipTake, type Paginated } from '../../shared/http/pagination.js';
import { checkManualTransition, formatOrderCode, returnsForCancellation } from './domain/index.js';
import { toOrderDetailDto, toOrderDto, type OrderDetailDto, type OrderDto } from './order.dto.js';
import { OrderStatusConflictError, type OrderRepository } from './order.repository.js';
import type { ChangeStatusBody, CreateOrderBody, OrderListQuery } from './order.schemas.js';

/** Status changes depend on the role (cancelling is ADMIN only). */
export type RoleActor = Actor & { role: Role };

export interface OrderService {
  list(query: OrderListQuery): Promise<Paginated<OrderDto>>;
  get(id: string): Promise<OrderDetailDto>;
  create(input: CreateOrderBody, actor: Actor): Promise<OrderDetailDto>;
  changeStatus(id: string, input: ChangeStatusBody, actor: RoleActor): Promise<OrderDetailDto>;
}

export interface OrderServiceDeps {
  orders: OrderRepository;
  customers: CustomerRepository;
  /** Business date in APP_TIMEZONE. */
  today: () => CalendarDate;
  newId?: () => string;
}

function notFound(id: string): AppError {
  return new AppError(404, 'NOT_FOUND', 'Order not found', { orderId: id });
}

function invalid(message: string, details: Record<string, unknown>): AppError {
  return new AppError(400, 'VALIDATION_ERROR', message, details);
}

function invalidTransition(from: string, to: string, reason: string): AppError {
  return new AppError(409, 'INVALID_STATUS_TRANSITION', 'This status change is not allowed', {
    from,
    to,
    reason,
  });
}

export function createOrderService({
  orders,
  customers,
  today,
  newId = randomUUID,
}: OrderServiceDeps): OrderService {
  async function detail(id: string): Promise<OrderDetailDto> {
    const order = await orders.findDetail(id);
    if (!order) throw notFound(id);
    return toOrderDetailDto(order);
  }

  async function checkProducts(productIds: string[]): Promise<void> {
    // One query for every item instead of one per product.
    const found = new Map(
      (await orders.productStatuses(productIds)).map((product) => [product.id, product.status]),
    );
    const missing = productIds.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new AppError(404, 'NOT_FOUND', 'Product not found', { productIds: missing });
    }
    const inactive = productIds.filter((id) => found.get(id) !== 'ACTIVE');
    if (inactive.length > 0) {
      throw invalid('Orders can only include active products', { productIds: inactive });
    }
  }

  return {
    async list(query) {
      const { items, total } = await orders.list(
        {
          statuses: query.status,
          priority: query.priority,
          customerId: query.customerId,
          dueBefore: query.dueBefore === undefined ? undefined : toDbDate(query.dueBefore),
        },
        toSkipTake(query),
      );
      return paginate(items.map(toOrderDto), total, query);
    },

    get: detail,

    async create(input, actor) {
      const customer = await customers.findById(input.customerId);
      if (!customer) {
        throw new AppError(404, 'NOT_FOUND', 'Customer not found', {
          customerId: input.customerId,
        });
      }
      if (customer.status !== 'ACTIVE') {
        throw invalid('Orders can only be placed for active customers', {
          customerId: input.customerId,
        });
      }
      const businessToday = today();
      if (daysBetween(businessToday, input.dueDate) < 0) {
        throw invalid('dueDate cannot be in the past', {
          field: 'dueDate',
          today: businessToday,
        });
      }
      await checkProducts(input.items.map((item) => item.productId));

      // No stock is reserved here: lots are assigned when a distribution
      // proposal is confirmed (PENDING -> IN_PREPARATION).
      const id = newId();
      await orders.create({
        id,
        customerId: input.customerId,
        priority: input.priority,
        dueDate: toDbDate(input.dueDate),
        notes: input.notes ?? null,
        createdById: actor.userId,
        items: input.items.map((item) => ({
          id: newId(),
          productId: item.productId,
          requestedQty: item.quantity,
        })),
        historyId: newId(),
        audit: buildAuditEntry({
          userId: actor.userId,
          action: AUDIT_ACTIONS.ORDER_CREATED,
          entity: 'Order',
          entityId: id,
          metadata: {
            customerId: input.customerId,
            priority: input.priority,
            dueDate: input.dueDate,
            items: input.items.length,
          },
          ip: actor.ip,
        }),
      });
      return detail(id);
    },

    async changeStatus(id, { status, note }, actor) {
      const order = await orders.findById(id);
      if (!order) throw notFound(id);

      const check = checkManualTransition(order.status, status, actor.role);
      if (!check.allowed) {
        if (check.denial === 'ROLE_FORBIDDEN') {
          throw new AppError(403, 'FORBIDDEN', 'Only an ADMIN can cancel an order', {
            from: order.status,
            to: status,
          });
        }
        throw invalidTransition(order.status, status, check.denial);
      }

      // Cancelling gives every dispatched quantity back to the lot it came from.
      const cancelling = status === 'CANCELLED';
      const returns = cancelling
        ? returnsForCancellation(
            (await orders.movementsOf(id)).map((m) => ({
              lotId: m.lotId,
              type: m.type,
              quantity: m.quantity.toNumber(),
            })),
          ).map((r) => ({ movementId: newId(), ...r }))
        : [];

      try {
        await orders.changeStatus({
          orderId: id,
          from: order.status,
          to: status,
          userId: actor.userId,
          note: note ?? null,
          historyId: newId(),
          returns,
          resetAllocations: cancelling,
          audit: buildAuditEntry({
            userId: actor.userId,
            action: AUDIT_ACTIONS.ORDER_STATUS_CHANGED,
            entity: 'Order',
            entityId: id,
            metadata: {
              code: formatOrderCode(order.number),
              from: order.status,
              to: status,
              returnedLots: returns.length,
            },
            ip: actor.ip,
          }),
        });
      } catch (error) {
        if (error instanceof OrderStatusConflictError) {
          throw invalidTransition(order.status, status, 'STATUS_CHANGED');
        }
        throw error;
      }
      return detail(id);
    },
  };
}

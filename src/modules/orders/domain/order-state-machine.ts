// Pure order rules: no Prisma, no clock, no I/O. The literal unions match the
// Prisma enums, so Prisma values can be passed in directly.
export type OrderStatus =
  'PENDING' | 'IN_PREPARATION' | 'READY_FOR_DISPATCH' | 'SHIPPED' | 'DELIVERED' | 'CANCELLED';

export type OrderRole = 'ADMIN' | 'OPERATOR';

/** Every transition of the contract's state machine (section 2). */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> =
  Object.freeze({
    PENDING: ['IN_PREPARATION', 'CANCELLED'],
    IN_PREPARATION: ['READY_FOR_DISPATCH', 'CANCELLED'],
    READY_FOR_DISPATCH: ['SHIPPED', 'CANCELLED'],
    SHIPPED: ['DELIVERED'],
    DELIVERED: [],
    CANCELLED: [],
  });

export type TransitionDenial =
  /** Not an edge of the state machine (including staying in the same status). */
  | 'NOT_ALLOWED'
  /** PENDING -> IN_PREPARATION only happens when a distribution proposal is confirmed. */
  | 'REQUIRES_PROPOSAL'
  /** A valid edge that this role cannot take (cancelling is ADMIN only). */
  | 'ROLE_FORBIDDEN';

export type TransitionCheck = { allowed: true } | { allowed: false; denial: TransitionDenial };

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

/**
 * Whether a user may move an order with PATCH /orders/:id/status.
 * The edge is checked before the role: an edge that does not exist is a 409
 * for everyone, and only a real edge the role cannot take is a 403.
 */
export function checkManualTransition(
  from: OrderStatus,
  to: OrderStatus,
  role: OrderRole,
): TransitionCheck {
  if (!canTransition(from, to)) return { allowed: false, denial: 'NOT_ALLOWED' };
  if (from === 'PENDING' && to === 'IN_PREPARATION') {
    return { allowed: false, denial: 'REQUIRES_PROPOSAL' };
  }
  if (to === 'CANCELLED' && role !== 'ADMIN') return { allowed: false, denial: 'ROLE_FORBIDDEN' };
  return { allowed: true };
}

/** Statuses whose goods have not left the warehouse yet. */
export function isOpen(status: OrderStatus): boolean {
  return status === 'PENDING' || status === 'IN_PREPARATION' || status === 'READY_FOR_DISPATCH';
}

import { describe, expect, it } from 'vitest';
import {
  canTransition,
  checkManualTransition,
  isOpen,
  ORDER_TRANSITIONS,
  type OrderRole,
  type OrderStatus,
} from '../src/modules/orders/domain/index.js';

const STATUSES = Object.keys(ORDER_TRANSITIONS) as OrderStatus[];
const ROLES: OrderRole[] = ['ADMIN', 'OPERATOR'];

/** Expected PATCH outcome for every (from, to, role); anything not listed is NOT_ALLOWED. */
const EXPECTED: Partial<Record<`${OrderStatus}->${OrderStatus}`, Record<OrderRole, string>>> = {
  'PENDING->IN_PREPARATION': { ADMIN: 'REQUIRES_PROPOSAL', OPERATOR: 'REQUIRES_PROPOSAL' },
  'PENDING->CANCELLED': { ADMIN: 'ALLOWED', OPERATOR: 'ROLE_FORBIDDEN' },
  'IN_PREPARATION->READY_FOR_DISPATCH': { ADMIN: 'ALLOWED', OPERATOR: 'ALLOWED' },
  'IN_PREPARATION->CANCELLED': { ADMIN: 'ALLOWED', OPERATOR: 'ROLE_FORBIDDEN' },
  'READY_FOR_DISPATCH->SHIPPED': { ADMIN: 'ALLOWED', OPERATOR: 'ALLOWED' },
  'READY_FOR_DISPATCH->CANCELLED': { ADMIN: 'ALLOWED', OPERATOR: 'ROLE_FORBIDDEN' },
  'SHIPPED->DELIVERED': { ADMIN: 'ALLOWED', OPERATOR: 'ALLOWED' },
};

const cases = STATUSES.flatMap((from) =>
  STATUSES.flatMap((to) =>
    ROLES.map((role) => ({
      from,
      to,
      role,
      expected: EXPECTED[`${from}->${to}`]?.[role] ?? 'NOT_ALLOWED',
    })),
  ),
);

describe('order state machine', () => {
  it('has exactly the edges of the contract diagram', () => {
    const edges = STATUSES.flatMap((from) => ORDER_TRANSITIONS[from].map((to) => `${from}->${to}`));
    expect(edges.sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it.each(cases)('$from -> $to by $role: $expected', ({ from, to, role, expected }) => {
    const check = checkManualTransition(from, to, role);
    expect(check.allowed ? 'ALLOWED' : check.denial).toBe(expected);
  });

  it('never allows staying in the same status', () => {
    for (const status of STATUSES) expect(canTransition(status, status)).toBe(false);
  });

  it('treats DELIVERED and CANCELLED as final', () => {
    expect(ORDER_TRANSITIONS.DELIVERED).toEqual([]);
    expect(ORDER_TRANSITIONS.CANCELLED).toEqual([]);
  });

  it('checks the edge before the role: an invalid cancel by an operator is NOT_ALLOWED', () => {
    expect(checkManualTransition('SHIPPED', 'CANCELLED', 'OPERATOR')).toEqual({
      allowed: false,
      denial: 'NOT_ALLOWED',
    });
  });

  it('considers only the three statuses before shipping as open', () => {
    expect(STATUSES.filter(isOpen)).toEqual(['PENDING', 'IN_PREPARATION', 'READY_FOR_DISPATCH']);
  });
});

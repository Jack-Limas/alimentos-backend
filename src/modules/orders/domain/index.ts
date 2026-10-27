// Pure order rules: no Prisma, no clock, no I/O.
export { formatOrderCode } from './order-code.js';
export { returnsForCancellation, type LotReturn, type OrderMovement } from './order-returns.js';
export {
  canTransition,
  checkManualTransition,
  isOpen,
  ORDER_TRANSITIONS,
  type OrderRole,
  type OrderStatus,
  type TransitionCheck,
  type TransitionDenial,
} from './order-state-machine.js';

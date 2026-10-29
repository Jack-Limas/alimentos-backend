// Pure inventory rules: no Prisma, no clock, no I/O.
export {
  addDays,
  daysBetween,
  fromDbDate,
  isCalendarDate,
  startOfDayIn,
  todayIn,
  toDbDate,
  type CalendarDate,
} from './calendar.js';
export {
  allocateFefo,
  compareFefo,
  isExpired,
  type FefoAllocation,
  type FefoLot,
  type FefoOptions,
  type FefoResult,
} from './fefo.js';
export { INVENTORY_RULES, type InventoryRules } from './inventory-rules.js';
export {
  productMetrics,
  type MetricsInput,
  type MetricsLot,
  type ProductMetrics,
  type StockStatus,
  type WasteRisk,
} from './product-metrics.js';
export {
  fromMilli,
  hasAtMostThreeDecimals,
  MAX_QTY,
  roundQty,
  sumQty,
  toMilli,
} from './quantity.js';
export type { Reason, ReasonCode } from './reasons.js';

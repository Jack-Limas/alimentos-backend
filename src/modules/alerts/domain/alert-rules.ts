import { INVENTORY_RULES, type InventoryRules } from '../../inventory/domain/index.js';

export interface AlertRules extends InventoryRules {
  /** A lot that expires within this many days (inclusive) is CRITICAL, not WARNING. */
  readonly CRITICAL_EXPIRY_DAYS: number;
  /** An open order due within this many days (inclusive) raises ORDER_DUE_SOON. */
  readonly ORDER_DUE_SOON_DAYS: number;
}

/** Alert thresholds; the inventory ones are shared with product metrics. */
export const ALERT_RULES: AlertRules = Object.freeze({
  ...INVENTORY_RULES,
  CRITICAL_EXPIRY_DAYS: 2,
  ORDER_DUE_SOON_DAYS: 2,
});

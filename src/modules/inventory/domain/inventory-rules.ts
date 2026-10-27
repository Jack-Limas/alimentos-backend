export interface InventoryRules {
  /** A lot that expires within this many days (inclusive) "expires soon". */
  readonly EXPIRY_WARNING_DAYS: number;
  /** Window used for the average daily outflow (EXIT_DISPATCH). */
  readonly OUTFLOW_WINDOW_DAYS: number;
}

/** Thresholds shared by product metrics, the inventory summary and alerts. */
export const INVENTORY_RULES: InventoryRules = Object.freeze({
  EXPIRY_WARNING_DAYS: 7,
  OUTFLOW_WINDOW_DAYS: 30,
});

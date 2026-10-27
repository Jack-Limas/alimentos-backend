export type ReasonCode =
  | 'OUT_OF_STOCK'
  | 'BELOW_MIN_STOCK'
  | 'EXPIRES_IN_DAYS'
  | 'EXPIRED_STOCK'
  | 'NO_RECENT_OUTFLOW'
  | 'COVERAGE_EXCEEDS_EXPIRY';

/**
 * Explanation as code + params (contract, section 3). The frontend translates
 * it; the backend never sends text.
 */
export interface Reason {
  code: ReasonCode;
  params: Record<string, number>;
}

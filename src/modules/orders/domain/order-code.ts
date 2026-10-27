const CODE_PREFIX = 'PED-';
const CODE_DIGITS = 6;

/** Readable order code from the contract: 123 -> "PED-000123". */
export function formatOrderCode(orderNumber: number): string {
  return `${CODE_PREFIX}${String(orderNumber).padStart(CODE_DIGITS, '0')}`;
}

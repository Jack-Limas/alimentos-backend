import { MovementType } from '@prisma/client';
import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/http/pagination.js';
import { hasAtMostThreeDecimals, isCalendarDate, MAX_QTY } from './domain/index.js';

const THREE_DECIMALS = 'must have at most 3 decimals';
const MAX_DAYS = 3650;

/** Decimal(12,3) that may be 0 (e.g. minStock). JSON numbers only, never strings. */
export const nonNegativeQuantitySchema = z
  .number()
  .min(0)
  .max(MAX_QTY)
  .refine(hasAtMostThreeDecimals, THREE_DECIMALS);

/** Decimal(12,3) strictly greater than 0 (movement quantities). */
export const positiveQuantitySchema = z
  .number()
  .positive()
  .max(MAX_QTY)
  .refine(hasAtMostThreeDecimals, THREE_DECIMALS);

export const calendarDateSchema = z
  .string()
  .refine(isCalendarDate, 'must be a valid date in YYYY-MM-DD format');

/** Query-string boolean: only "true" and "false" are accepted. */
const queryBoolean = z
  .enum(['true', 'false'])
  .optional()
  .transform((value) => value === 'true');

const expiringWithinDays = z.coerce.number().int().min(0).max(MAX_DAYS).optional();
const optionalText = (max: number) => z.string().trim().min(1).max(max).optional();

export const lotListQuerySchema = paginationQuerySchema.extend({
  productId: z.uuid().optional(),
  expiringWithinDays,
  includeExpired: queryBoolean,
});

export const movementListQuerySchema = paginationQuerySchema
  .extend({
    productId: z.uuid().optional(),
    type: z.enum(MovementType).optional(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
  })
  .refine((query) => !query.from || !query.to || new Date(query.from) <= new Date(query.to), {
    message: '`from` must be before `to`',
    path: ['from'],
  });

// strictObject: unknown fields (e.g. a computed figure sent by the client) are a 400.
export const entryBodySchema = z.strictObject({
  productId: z.uuid(),
  quantity: positiveQuantitySchema,
  expiryDate: calendarDateSchema,
  lotCode: optionalText(64),
  note: optionalText(500),
});

export const EXIT_TYPES = ['EXIT_WASTE', 'ADJUSTMENT'] as const;

export const exitBodySchema = z.strictObject({
  productId: z.uuid(),
  quantity: positiveQuantitySchema,
  type: z.enum(EXIT_TYPES),
  lotId: z.uuid().optional(),
  reason: z.string().trim().min(1).max(500),
});

export { expiringWithinDays as expiringWithinDaysSchema };

export type LotListQuery = z.infer<typeof lotListQuerySchema>;
export type MovementListQuery = z.infer<typeof movementListQuerySchema>;
export type EntryBody = z.infer<typeof entryBodySchema>;
export type ExitBody = z.infer<typeof exitBodySchema>;

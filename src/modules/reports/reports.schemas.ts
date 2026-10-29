import { z } from 'zod';
import { isCalendarDate } from '../inventory/domain/index.js';

const calendarDate = z.string().refine(isCalendarDate, 'must be a date YYYY-MM-DD');

export const reportKindParamsSchema = z.object({
  kind: z.enum(['inventory', 'orders', 'waste']),
});

export const reportQuerySchema = z.strictObject({
  format: z.enum(['csv', 'pdf']).default('csv'),
  locale: z.enum(['es', 'en']).default('es'),
  from: calendarDate.optional(),
  to: calendarDate.optional(),
});

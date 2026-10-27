import { CustomerStatus, CustomerType } from '@prisma/client';
import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/http/pagination.js';

const name = z.string().trim().min(1).max(120);
const address = z.string().trim().min(1).max(200);
// Colombian landlines and mobiles, with an optional +57 and common separators.
const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9 ()-]{5,18}[0-9]$/, 'must be a phone number');
const email = z
  .email()
  .max(254)
  .transform((value) => value.toLowerCase());

export const customerIdParamsSchema = z.object({ id: z.uuid() });

export const createCustomerSchema = z.strictObject({
  name,
  type: z.enum(CustomerType),
  address,
  phone: phone.optional(),
  email: email.optional(),
});

export const updateCustomerSchema = z
  .strictObject({
    name: name.optional(),
    type: z.enum(CustomerType).optional(),
    address: address.optional(),
    // null clears the field.
    phone: phone.nullable().optional(),
    email: email.nullable().optional(),
    status: z.enum(CustomerStatus).optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: 'at least one field is required',
  });

export const customerListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().min(1).max(120).optional(),
  type: z.enum(CustomerType).optional(),
  status: z.enum(CustomerStatus).optional(),
});

export type CreateCustomerBody = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerBody = z.infer<typeof updateCustomerSchema>;
export type CustomerListQuery = z.infer<typeof customerListQuerySchema>;

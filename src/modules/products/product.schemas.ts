import { ProductCategory, ProductStatus, Unit } from '@prisma/client';
import { z } from 'zod';
import { paginationQuerySchema } from '../../shared/http/pagination.js';
import { nonNegativeQuantitySchema } from '../inventory/inventory.schemas.js';

const name = z.string().trim().min(1).max(120);

export const productIdParamsSchema = z.object({ id: z.uuid() });

// strictObject: computed fields (availableQty, wasteRisk...) sent by a client are a 400.
export const createProductSchema = z.strictObject({
  name,
  category: z.enum(ProductCategory),
  unit: z.enum(Unit),
  minStock: nonNegativeQuantitySchema,
});

export const updateProductSchema = z
  .strictObject({
    name: name.optional(),
    category: z.enum(ProductCategory).optional(),
    unit: z.enum(Unit).optional(),
    minStock: nonNegativeQuantitySchema.optional(),
    status: z.enum(ProductStatus).optional(),
  })
  .refine((patch) => Object.values(patch).some((value) => value !== undefined), {
    message: 'at least one field is required',
  });

export const productListQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().min(1).max(120).optional(),
  category: z.enum(ProductCategory).optional(),
  status: z.enum(ProductStatus).optional(),
  stockStatus: z.enum(['LOW', 'OUT']).optional(),
  wasteRisk: z.enum(['HIGH', 'LOW', 'NONE']).optional(),
  expiringWithinDays: z.coerce.number().int().min(0).max(3650).optional(),
});

export type CreateProductBody = z.infer<typeof createProductSchema>;
export type UpdateProductBody = z.infer<typeof updateProductSchema>;
export type ProductListQuery = z.infer<typeof productListQuerySchema>;

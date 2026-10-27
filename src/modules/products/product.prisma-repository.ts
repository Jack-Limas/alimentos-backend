import type { Prisma, PrismaClient } from '@prisma/client';
import { auditLogData, isUniqueViolation, toDecimalInput } from '../../shared/db/prisma-helpers.js';
import {
  DuplicateProductNameError,
  type ProductFilter,
  type ProductPatch,
  type ProductRepository,
} from './product.repository.js';

/** Only the fields present in the patch (Prisma rejects explicit undefined). */
function toUpdateData(patch: ProductPatch): Prisma.ProductUpdateInput {
  const data: Prisma.ProductUpdateInput = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.category !== undefined) data.category = patch.category;
  if (patch.unit !== undefined) data.unit = patch.unit;
  if (patch.minStock !== undefined) data.minStock = toDecimalInput(patch.minStock);
  if (patch.status !== undefined) data.status = patch.status;
  return data;
}

function toWhere(filter: ProductFilter): Prisma.ProductWhereInput {
  return {
    ...(filter.search ? { name: { contains: filter.search, mode: 'insensitive' } } : {}),
    ...(filter.category ? { category: filter.category } : {}),
    ...(filter.status ? { status: filter.status } : {}),
  };
}

export function createPrismaProductRepository(prisma: PrismaClient): ProductRepository {
  return {
    findById: (id) => prisma.product.findUnique({ where: { id } }),

    findByName: (name, excludeId) =>
      prisma.product.findFirst({
        where: {
          name: { equals: name, mode: 'insensitive' },
          ...(excludeId ? { NOT: { id: excludeId } } : {}),
        },
      }),

    async list(filter, page) {
      const where = toWhere(filter);
      const [items, total] = await prisma.$transaction([
        prisma.product.findMany({
          where,
          orderBy: { name: 'asc' },
          ...(page ? { skip: page.skip, take: page.take } : {}),
        }),
        prisma.product.count({ where }),
      ]);
      return { items, total };
    },

    async create(product, audit) {
      try {
        const [created] = await prisma.$transaction([
          prisma.product.create({
            data: { ...product, minStock: toDecimalInput(product.minStock) },
          }),
          prisma.auditLog.create({ data: auditLogData(audit) }),
        ]);
        return created;
      } catch (error) {
        // Two concurrent creates can both pass the service's name check.
        if (isUniqueViolation(error)) throw new DuplicateProductNameError(product.name);
        throw error;
      }
    },

    async update(id, patch, audit) {
      try {
        const [updated] = await prisma.$transaction([
          prisma.product.update({
            where: { id },
            data: toUpdateData(patch),
          }),
          prisma.auditLog.create({ data: auditLogData(audit) }),
        ]);
        return updated;
      } catch (error) {
        if (isUniqueViolation(error)) throw new DuplicateProductNameError(patch.name ?? '');
        throw error;
      }
    },
  };
}

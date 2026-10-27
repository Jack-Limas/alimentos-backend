import type { Prisma, PrismaClient } from '@prisma/client';
import { auditLogData } from '../../shared/db/prisma-helpers.js';
import type { CustomerFilter, CustomerPatch, CustomerRepository } from './customer.repository.js';

/** Only the fields present in the patch (Prisma rejects explicit undefined). */
function toUpdateData(patch: CustomerPatch): Prisma.CustomerUpdateInput {
  const data: Prisma.CustomerUpdateInput = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.type !== undefined) data.type = patch.type;
  if (patch.address !== undefined) data.address = patch.address;
  if (patch.phone !== undefined) data.phone = patch.phone;
  if (patch.email !== undefined) data.email = patch.email;
  if (patch.status !== undefined) data.status = patch.status;
  return data;
}

function toWhere(filter: CustomerFilter): Prisma.CustomerWhereInput {
  return {
    ...(filter.search ? { name: { contains: filter.search, mode: 'insensitive' } } : {}),
    ...(filter.type ? { type: filter.type } : {}),
    ...(filter.status ? { status: filter.status } : {}),
  };
}

export function createPrismaCustomerRepository(prisma: PrismaClient): CustomerRepository {
  return {
    findById: (id) => prisma.customer.findUnique({ where: { id } }),

    async list(filter, page) {
      const where = toWhere(filter);
      const [items, total] = await prisma.$transaction([
        prisma.customer.findMany({
          where,
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          skip: page.skip,
          take: page.take,
        }),
        prisma.customer.count({ where }),
      ]);
      return { items, total };
    },

    async create(customer, audit) {
      const [created] = await prisma.$transaction([
        prisma.customer.create({ data: customer }),
        prisma.auditLog.create({ data: auditLogData(audit) }),
      ]);
      return created;
    },

    async update(id, patch, audit) {
      const [updated] = await prisma.$transaction([
        prisma.customer.update({ where: { id }, data: toUpdateData(patch) }),
        prisma.auditLog.create({ data: auditLogData(audit) }),
      ]);
      return updated;
    },
  };
}

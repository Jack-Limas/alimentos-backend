import type { PrismaClient } from '@prisma/client';
import { toDbDate } from '../modules/inventory/domain/index.js';
import { toDecimalInput } from '../shared/db/prisma-helpers.js';
import type { CatalogSeedStore } from './seed-catalog.js';

export function createPrismaCatalogSeedStore(prisma: PrismaClient): CatalogSeedStore {
  return {
    countProducts: () => prisma.product.count(),

    async insertCatalogWithInventory(products, lots, movements) {
      await prisma.$transaction([
        prisma.product.createMany({
          data: products.map((p) => ({ ...p, minStock: toDecimalInput(p.minStock) })),
        }),
        prisma.inventoryLot.createMany({
          data: lots.map((lot) => ({
            ...lot,
            quantity: toDecimalInput(lot.quantity),
            initialQuantity: toDecimalInput(lot.initialQuantity),
            expiryDate: toDbDate(lot.expiryDate),
            createdAt: lot.receivedAt,
          })),
        }),
        prisma.inventoryMovement.createMany({
          data: movements.map((m) => ({ ...m, quantity: toDecimalInput(m.quantity) })),
        }),
      ]);
    },

    async createMissingProducts(products) {
      // The unique name index makes skipDuplicates keep existing products as they are.
      const { count } = await prisma.product.createMany({
        data: products.map((p) => ({ ...p, minStock: toDecimalInput(p.minStock) })),
        skipDuplicates: true,
      });
      return count;
    },
  };
}

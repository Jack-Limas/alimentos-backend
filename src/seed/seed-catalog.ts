import { randomUUID } from 'node:crypto';
import type { ProductCategory, Unit } from '@prisma/client';
import type { CalendarDate } from '../modules/inventory/domain/index.js';
import { CATALOG, type CatalogItem } from './catalog.js';
import { buildDemoInventory, type DemoLot, type DemoMovement } from './demo-inventory.js';

export interface CatalogProduct {
  id: string;
  name: string;
  category: ProductCategory;
  unit: Unit;
  minStock: number;
}

export interface CatalogSeedStore {
  countProducts(): Promise<number>;
  /** Products, lots and movements in a single transaction. */
  insertCatalogWithInventory(
    products: CatalogProduct[],
    lots: DemoLot[],
    movements: DemoMovement[],
  ): Promise<void>;
  /** Creates only the products whose name does not exist yet; returns how many. */
  createMissingProducts(products: CatalogProduct[]): Promise<number>;
}

export interface CatalogSeedResult {
  productsCreated: number;
  lotsCreated: number;
  movementsCreated: number;
  /** False when products already existed: their inventory is left untouched. */
  inventorySeeded: boolean;
}

export interface SeedCatalogInput {
  store: CatalogSeedStore;
  /** Recorded as the user of the demo movements. */
  adminUserId: string;
  today: CalendarDate;
  catalog?: readonly CatalogItem[];
  newId?: () => string;
}

/**
 * Idempotent catalog seed.
 * - Empty products table: creates the catalog plus demo lots and movements,
 *   all in one transaction (a failure leaves the table empty for a retry).
 * - Otherwise: only adds catalog products that are missing and never touches
 *   inventory, so running it again never duplicates anything.
 */
export async function seedCatalog({
  store,
  adminUserId,
  today,
  catalog = CATALOG,
  newId = randomUUID,
}: SeedCatalogInput): Promise<CatalogSeedResult> {
  const products = catalog.map((item) => ({
    product: {
      id: newId(),
      name: item.name,
      category: item.category,
      unit: item.unit,
      minStock: item.minStock,
    },
    item,
  }));
  const rows = products.map(({ product }) => product);

  if ((await store.countProducts()) > 0) {
    const created = await store.createMissingProducts(rows);
    return {
      productsCreated: created,
      lotsCreated: 0,
      movementsCreated: 0,
      inventorySeeded: false,
    };
  }

  const { lots, movements } = buildDemoInventory({
    products: products.map(({ product, item }) => ({ id: product.id, item })),
    today,
    userId: adminUserId,
    newId,
  });
  await store.insertCatalogWithInventory(rows, lots, movements);
  return {
    productsCreated: rows.length,
    lotsCreated: lots.length,
    movementsCreated: movements.length,
    inventorySeeded: true,
  };
}

import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import type { AuditLogRepository } from '../../src/modules/audit/audit-log.repository.js';
import {
  InsufficientStockError,
  type InventoryRepository,
  type LotRecord,
  type MovementRecord,
} from '../../src/modules/inventory/inventory.repository.js';
import {
  DuplicateProductNameError,
  type ProductRecord,
  type ProductRepository,
} from '../../src/modules/products/product.repository.js';

// Records hold Prisma.Decimal like the real repositories, so tests prove that
// the API turns them into JSON numbers.
export const dec = (value: number): Prisma.Decimal => new Prisma.Decimal(value.toFixed(3));

const byDateThenId = (a: LotRecord, b: LotRecord) =>
  a.expiryDate.getTime() - b.expiryDate.getTime() ||
  a.receivedAt.getTime() - b.receivedAt.getTime() ||
  (a.id < b.id ? -1 : 1);

export function createInMemoryProductRepository(audit: AuditLogRepository) {
  const products = new Map<string, ProductRecord>();
  const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

  const repository: ProductRepository & { products: Map<string, ProductRecord> } = {
    products,
    findById: (id) => Promise.resolve(products.get(id) ?? null),
    findByName: (name, excludeId) =>
      Promise.resolve(
        [...products.values()].find((p) => sameName(p.name, name) && p.id !== excludeId) ?? null,
      ),
    list(filter, page) {
      const matched = [...products.values()]
        .filter((p) => !filter.search || p.name.toLowerCase().includes(filter.search.toLowerCase()))
        .filter((p) => !filter.category || p.category === filter.category)
        .filter((p) => !filter.status || p.status === filter.status)
        .sort((a, b) => (a.name < b.name ? -1 : 1));
      const items = page ? matched.slice(page.skip, page.skip + page.take) : matched;
      return Promise.resolve({ items, total: matched.length });
    },
    async create(product, entry) {
      // Exact match, like the database unique index.
      if ([...products.values()].some((p) => p.name === product.name)) {
        throw new DuplicateProductNameError(product.name);
      }
      const now = new Date();
      const record: ProductRecord = {
        ...product,
        minStock: dec(product.minStock),
        status: 'ACTIVE',
        photoUrl: null,
        createdAt: now,
        updatedAt: now,
      };
      products.set(record.id, record);
      await audit.create(entry);
      return record;
    },
    async update(id, patch, entry) {
      const current = products.get(id);
      if (!current) throw new Error('not found');
      const updated: ProductRecord = {
        ...current,
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.category === undefined ? {} : { category: patch.category }),
        ...(patch.unit === undefined ? {} : { unit: patch.unit }),
        ...(patch.status === undefined ? {} : { status: patch.status }),
        ...(patch.minStock === undefined ? {} : { minStock: dec(patch.minStock) }),
        updatedAt: new Date(),
      };
      products.set(id, updated);
      await audit.create(entry);
      return updated;
    },
  };
  return repository;
}

export function createInMemoryInventoryRepository(audit: AuditLogRepository) {
  const lots = new Map<string, LotRecord>();
  const movements: MovementRecord[] = [];
  const productOf = (lotId: string) => lots.get(lotId)?.productId ?? '';

  const repository: InventoryRepository & {
    lots: Map<string, LotRecord>;
    movements: MovementRecord[];
    addLot(
      lot: Partial<LotRecord> & { productId: string; quantity: number; expiryDate: string },
    ): LotRecord;
    addMovement(
      movement: Omit<MovementRecord, 'id' | 'productId' | 'quantity'> & { quantity: number },
    ): void;
  } = {
    lots,
    movements,

    addLot({ quantity, expiryDate, ...rest }) {
      const record: LotRecord = {
        id: randomUUID(),
        lotCode: null,
        receivedAt: new Date('2026-10-01T12:00:00Z'),
        createdAt: new Date('2026-10-01T12:00:00Z'),
        ...rest,
        quantity: dec(quantity),
        initialQuantity: rest.initialQuantity ?? dec(quantity),
        expiryDate: new Date(`${expiryDate}T00:00:00.000Z`),
      };
      lots.set(record.id, record);
      return record;
    },

    addMovement({ quantity, ...movement }) {
      movements.push({
        ...movement,
        id: randomUUID(),
        productId: productOf(movement.lotId),
        quantity: dec(quantity),
      });
    },

    stockByExpiry(productIds) {
      const rows = new Map<
        string,
        { productId: string; expiryDate: Date; quantity: Prisma.Decimal }
      >();
      for (const lot of lots.values()) {
        if (lot.quantity.lte(0) || (productIds && !productIds.includes(lot.productId))) continue;
        const key = `${lot.productId}|${lot.expiryDate.toISOString()}`;
        const row = rows.get(key);
        if (row) row.quantity = row.quantity.plus(lot.quantity);
        else
          rows.set(key, {
            productId: lot.productId,
            expiryDate: lot.expiryDate,
            quantity: lot.quantity,
          });
      }
      return Promise.resolve([...rows.values()]);
    },

    dispatchedSince(since, productIds) {
      const totals = new Map<string, Prisma.Decimal>();
      for (const m of movements) {
        if (m.type !== 'EXIT_DISPATCH' || m.createdAt < since) continue;
        if (productIds && !productIds.includes(m.productId)) continue;
        totals.set(m.productId, (totals.get(m.productId) ?? dec(0)).plus(m.quantity));
      }
      return Promise.resolve([...totals].map(([productId, quantity]) => ({ productId, quantity })));
    },

    findLot: (id) => Promise.resolve(lots.get(id) ?? null),

    lotsWithStock: (productId) =>
      Promise.resolve(
        [...lots.values()]
          .filter((lot) => lot.productId === productId && lot.quantity.gt(0))
          .sort(byDateThenId),
      ),

    listLots(filter, page) {
      const matched = [...lots.values()]
        .filter((lot) => lot.quantity.gt(0))
        .filter((lot) => !filter.productId || lot.productId === filter.productId)
        .filter((lot) => !filter.expiryFrom || lot.expiryDate >= filter.expiryFrom)
        .filter((lot) => !filter.expiryTo || lot.expiryDate <= filter.expiryTo)
        .sort(byDateThenId);
      return Promise.resolve({
        items: matched.slice(page.skip, page.skip + page.take),
        total: matched.length,
      });
    },

    listMovements(filter, page) {
      const matched = movements
        .filter((m) => !filter.productId || m.productId === filter.productId)
        .filter((m) => !filter.type || m.type === filter.type)
        .filter((m) => !filter.from || m.createdAt >= filter.from)
        .filter((m) => !filter.to || m.createdAt <= filter.to)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return Promise.resolve({
        items: matched.slice(page.skip, page.skip + page.take),
        total: matched.length,
      });
    },

    async createEntry({ lot, movement, audit: entry }) {
      const now = new Date();
      const record: LotRecord = {
        ...lot,
        quantity: dec(lot.quantity),
        initialQuantity: dec(lot.quantity),
        receivedAt: now,
        createdAt: now,
      };
      const movementRecord: MovementRecord = {
        ...movement,
        lotId: lot.id,
        productId: lot.productId,
        type: 'ENTRY',
        quantity: dec(lot.quantity),
        orderId: null,
        createdAt: now,
      };
      lots.set(record.id, record);
      movements.push(movementRecord);
      await audit.create(entry);
      return { lot: record, movement: movementRecord };
    },

    async applyExits({ type, reason, userId, allocations, audit: entry }) {
      // Same all-or-nothing contract as the transaction: validate every
      // decrement first, then apply them all.
      const remaining = new Map<string, Prisma.Decimal>();
      for (const { lotId, qty } of allocations) {
        const current = remaining.get(lotId) ?? lots.get(lotId)?.quantity;
        if (!current || current.lt(dec(qty))) throw new InsufficientStockError(lotId);
        remaining.set(lotId, current.minus(dec(qty)));
      }
      const now = new Date();
      const created: MovementRecord[] = [];
      for (const [lotId, quantity] of remaining) {
        const lot = lots.get(lotId);
        if (lot) lots.set(lotId, { ...lot, quantity });
      }
      for (const { movementId, lotId, qty } of allocations) {
        const record: MovementRecord = {
          id: movementId,
          lotId,
          productId: productOf(lotId),
          type,
          quantity: dec(qty),
          reason,
          orderId: null,
          userId,
          createdAt: now,
        };
        movements.push(record);
        created.push(record);
      }
      await audit.create(entry);
      return created;
    },
  };
  return repository;
}

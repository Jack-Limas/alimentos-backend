import { randomUUID } from 'node:crypto';
import { AUDIT_ACTIONS, buildAuditEntry } from '../audit/index.js';
import type { ProductRepository } from '../products/product.repository.js';
import { AppError } from '../../shared/errors/index.js';
import type { Actor } from '../../shared/http/actor.js';
import { paginate, toSkipTake, type Paginated } from '../../shared/http/pagination.js';
import {
  addDays,
  allocateFefo,
  daysBetween,
  fromDbDate,
  INVENTORY_RULES,
  toDbDate,
  type FefoAllocation,
} from './domain/index.js';
import { toLotDto, toMovementDto, type LotDto, type MovementDto } from './inventory.dto.js';
import type { InventoryMetricsService } from './inventory-metrics.service.js';
import { InsufficientStockError, type InventoryRepository } from './inventory.repository.js';
import type { EntryBody, ExitBody, LotListQuery, MovementListQuery } from './inventory.schemas.js';

export interface InventorySummary {
  /** Active products. */
  totalProducts: number;
  /** Active products below their minimum stock (with some stock left). */
  lowStock: number;
  /** Active products without non-expired stock. */
  outOfStock: number;
  /** Active products whose nearest lot expires within EXPIRY_WARNING_DAYS. */
  expiringSoon: number;
  wasteRiskHigh: number;
}

export interface EntryResult {
  lot: LotDto;
  movement: MovementDto;
}

export interface ExitResult {
  allocations: FefoAllocation[];
  movements: MovementDto[];
}

export interface InventoryService {
  listLots(query: LotListQuery): Promise<Paginated<LotDto>>;
  listMovements(query: MovementListQuery): Promise<Paginated<MovementDto>>;
  summary(): Promise<InventorySummary>;
  createEntry(input: EntryBody, actor: Actor): Promise<EntryResult>;
  createExit(input: ExitBody, actor: Actor): Promise<ExitResult>;
}

export interface InventoryServiceDeps {
  products: ProductRepository;
  inventory: InventoryRepository;
  metrics: InventoryMetricsService;
  newId?: () => string;
}

function insufficientStock(details: Record<string, unknown>): AppError {
  return new AppError(409, 'INSUFFICIENT_STOCK', 'Not enough stock for this exit', details);
}

export function createInventoryService({
  products,
  inventory,
  metrics,
  newId = randomUUID,
}: InventoryServiceDeps): InventoryService {
  async function requireProduct(productId: string) {
    const product = await products.findById(productId);
    if (!product) throw new AppError(404, 'NOT_FOUND', 'Product not found', { productId });
    return product;
  }

  /** Lots to take from: the given one, or FEFO over the product's lots. */
  async function planExit(input: ExitBody): Promise<FefoAllocation[]> {
    if (input.lotId) {
      const lot = await inventory.findLot(input.lotId);
      if (lot?.productId !== input.productId) {
        throw new AppError(404, 'NOT_FOUND', 'Lot not found for this product', {
          lotId: input.lotId,
          productId: input.productId,
        });
      }
      // Whether the lot has enough is decided atomically by the conditional update.
      return [{ lotId: lot.id, qty: input.quantity }];
    }

    const lots = await inventory.lotsWithStock(input.productId);
    const plan = allocateFefo(
      lots.map((lot) => ({
        id: lot.id,
        quantity: lot.quantity.toNumber(),
        expiryDate: fromDbDate(lot.expiryDate),
        receivedAt: lot.receivedAt,
      })),
      input.quantity,
      // Only waste may consume expired lots; an adjustment touches sellable stock.
      { today: metrics.today(), includeExpired: input.type === 'EXIT_WASTE' },
    );
    if (plan.shortfall > 0) {
      throw insufficientStock({
        productId: input.productId,
        requested: input.quantity,
        available: plan.allocatedQty,
      });
    }
    return plan.allocations;
  }

  return {
    async listLots(query) {
      const today = metrics.today();
      const { items, total } = await inventory.listLots(
        {
          productId: query.productId,
          expiryFrom: query.includeExpired ? undefined : toDbDate(today),
          expiryTo:
            query.expiringWithinDays === undefined
              ? undefined
              : toDbDate(addDays(today, query.expiringWithinDays)),
        },
        toSkipTake(query),
      );
      return paginate(
        items.map((lot) => toLotDto(lot, today)),
        total,
        query,
      );
    },

    async listMovements(query) {
      const { items, total } = await inventory.listMovements(
        {
          productId: query.productId,
          type: query.type,
          from: query.from ? new Date(query.from) : undefined,
          to: query.to ? new Date(query.to) : undefined,
        },
        toSkipTake(query),
      );
      return paginate(items.map(toMovementDto), total, query);
    },

    async summary() {
      const { items } = await products.list({ status: 'ACTIVE' });
      const byProduct = await metrics.metricsFor(
        items.map((product) => ({ id: product.id, minStock: product.minStock.toNumber() })),
      );
      const summary: InventorySummary = {
        totalProducts: items.length,
        lowStock: 0,
        outOfStock: 0,
        expiringSoon: 0,
        wasteRiskHigh: 0,
      };
      for (const result of byProduct.values()) {
        if (result.stockStatus === 'LOW') summary.lowStock += 1;
        if (result.stockStatus === 'OUT') summary.outOfStock += 1;
        if (
          result.daysToNearestExpiry !== null &&
          result.daysToNearestExpiry <= INVENTORY_RULES.EXPIRY_WARNING_DAYS
        ) {
          summary.expiringSoon += 1;
        }
        if (result.wasteRisk === 'HIGH') summary.wasteRiskHigh += 1;
      }
      return summary;
    },

    async createEntry(input, actor) {
      const product = await requireProduct(input.productId);
      if (product.status !== 'ACTIVE') {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          'Cannot receive stock for an inactive product',
          {
            productId: product.id,
            status: product.status,
          },
        );
      }
      const today = metrics.today();
      if (daysBetween(today, input.expiryDate) < 0) {
        throw new AppError(400, 'VALIDATION_ERROR', 'expiryDate cannot be in the past', {
          expiryDate: input.expiryDate,
          today,
        });
      }

      const lotId = newId();
      const { lot, movement } = await inventory.createEntry({
        lot: {
          id: lotId,
          productId: product.id,
          lotCode: input.lotCode ?? null,
          quantity: input.quantity,
          expiryDate: toDbDate(input.expiryDate),
        },
        movement: { id: newId(), reason: input.note ?? null, userId: actor.userId },
        audit: buildAuditEntry({
          userId: actor.userId,
          action: AUDIT_ACTIONS.INVENTORY_ENTRY,
          entity: 'InventoryLot',
          entityId: lotId,
          metadata: {
            productId: product.id,
            quantity: input.quantity,
            expiryDate: input.expiryDate,
            lotCode: input.lotCode ?? null,
          },
          ip: actor.ip,
        }),
      });
      return { lot: toLotDto(lot, today), movement: toMovementDto(movement) };
    },

    async createExit(input, actor) {
      await requireProduct(input.productId);
      const allocations = await planExit(input);

      try {
        const movements = await inventory.applyExits({
          type: input.type,
          reason: input.reason,
          userId: actor.userId,
          allocations: allocations.map((allocation) => ({ ...allocation, movementId: newId() })),
          audit: buildAuditEntry({
            userId: actor.userId,
            action: AUDIT_ACTIONS.INVENTORY_EXIT,
            entity: 'Product',
            entityId: input.productId,
            metadata: {
              type: input.type,
              quantity: input.quantity,
              reason: input.reason,
              allocations,
            },
            ip: actor.ip,
          }),
        });
        return { allocations, movements: movements.map(toMovementDto) };
      } catch (error) {
        if (error instanceof InsufficientStockError) {
          throw insufficientStock({
            productId: input.productId,
            lotId: error.lotId,
            requested: input.quantity,
          });
        }
        throw error;
      }
    },
  };
}

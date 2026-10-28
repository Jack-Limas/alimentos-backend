import { randomUUID } from 'node:crypto';
import { AUDIT_ACTIONS, buildAuditEntry } from '../audit/index.js';
import type { ProductMetrics } from '../inventory/domain/index.js';
import { toLotDto } from '../inventory/inventory.dto.js';
import type { InventoryMetricsService } from '../inventory/inventory-metrics.service.js';
import type { InventoryRepository } from '../inventory/inventory.repository.js';
import { AppError } from '../../shared/errors/index.js';
import type { Actor } from '../../shared/http/actor.js';
import { paginate, toSkipTake, type Paginated } from '../../shared/http/pagination.js';
import { toProductDto, type ProductDetailDto, type ProductDto } from './product.dto.js';
import {
  DuplicateProductNameError,
  type ProductRecord,
  type ProductRepository,
} from './product.repository.js';
import type { CreateProductBody, ProductListQuery, UpdateProductBody } from './product.schemas.js';

export interface ProductService {
  list(query: ProductListQuery): Promise<Paginated<ProductDto>>;
  get(id: string): Promise<ProductDetailDto>;
  create(input: CreateProductBody, actor: Actor): Promise<ProductDto>;
  update(id: string, patch: UpdateProductBody, actor: Actor): Promise<ProductDto>;
}

export interface ProductServiceDeps {
  products: ProductRepository;
  inventory: InventoryRepository;
  metrics: InventoryMetricsService;
  newId?: () => string;
}

function duplicateName(name: string): AppError {
  return new AppError(409, 'DUPLICATE', 'A product with this name already exists', {
    field: 'name',
    name,
  });
}

function notFound(id: string): AppError {
  return new AppError(404, 'NOT_FOUND', 'Product not found', { productId: id });
}

export function createProductService({
  products,
  inventory,
  metrics,
  newId = randomUUID,
}: ProductServiceDeps): ProductService {
  async function withMetrics(items: ProductRecord[]): Promise<ProductDto[]> {
    const byProduct = await metrics.metricsFor(
      items.map((product) => ({ id: product.id, minStock: product.minStock.toNumber() })),
    );
    return items.map((product) => {
      const result = byProduct.get(product.id);
      if (!result) throw new Error(`Missing metrics for product ${product.id}`);
      return toProductDto(product, result);
    });
  }

  async function one(product: ProductRecord): Promise<ProductDto> {
    const [dto] = await withMetrics([product]);
    if (!dto) throw new Error(`Missing metrics for product ${product.id}`);
    return dto;
  }

  function matchesComputed(dto: ProductMetrics, query: ProductListQuery): boolean {
    if (query.stockStatus && dto.stockStatus !== query.stockStatus) return false;
    if (query.wasteRisk && dto.wasteRisk !== query.wasteRisk) return false;
    if (query.expiringWithinDays !== undefined) {
      return (
        dto.daysToNearestExpiry !== null && dto.daysToNearestExpiry <= query.expiringWithinDays
      );
    }
    return true;
  }

  return {
    async list(query) {
      const filter = { search: query.search, category: query.category, status: query.status };
      const page = toSkipTake(query);

      const computed =
        query.stockStatus !== undefined ||
        query.wasteRisk !== undefined ||
        query.expiringWithinDays !== undefined;
      if (!computed) {
        const { items, total } = await products.list(filter, page);
        return paginate(await withMetrics(items), total, query);
      }

      // stockStatus, wasteRisk and expiringWithinDays depend on live stock and outflow, which
      // only exist after computing the metrics, so the database cannot paginate:
      // compute them for every product that passes the stored filters, then page.
      const { items } = await products.list(filter);
      const matched = (await withMetrics(items)).filter((dto) => matchesComputed(dto, query));
      return paginate(matched.slice(page.skip, page.skip + page.take), matched.length, query);
    },

    async get(id) {
      const product = await products.findById(id);
      if (!product) throw notFound(id);
      const [dto, lots] = await Promise.all([one(product), inventory.lotsWithStock(id)]);
      const today = metrics.today();
      return { ...dto, lots: lots.map((lot) => toLotDto(lot, today)) };
    },

    async create(input, actor) {
      if (await products.findByName(input.name)) throw duplicateName(input.name);
      const id = newId();
      try {
        const created = await products.create(
          { id, ...input },
          buildAuditEntry({
            userId: actor.userId,
            action: AUDIT_ACTIONS.PRODUCT_CREATED,
            entity: 'Product',
            entityId: id,
            metadata: { ...input },
            ip: actor.ip,
          }),
        );
        return await one(created);
      } catch (error) {
        if (error instanceof DuplicateProductNameError) throw duplicateName(input.name);
        throw error;
      }
    },

    async update(id, patch, actor) {
      const existing = await products.findById(id);
      if (!existing) throw notFound(id);
      if (patch.name && (await products.findByName(patch.name, id)))
        throw duplicateName(patch.name);
      try {
        const updated = await products.update(
          id,
          patch,
          buildAuditEntry({
            userId: actor.userId,
            action: AUDIT_ACTIONS.PRODUCT_UPDATED,
            entity: 'Product',
            entityId: id,
            metadata: { changes: { ...patch } },
            ip: actor.ip,
          }),
        );
        return await one(updated);
      } catch (error) {
        if (error instanceof DuplicateProductNameError) throw duplicateName(patch.name ?? '');
        throw error;
      }
    },
  };
}

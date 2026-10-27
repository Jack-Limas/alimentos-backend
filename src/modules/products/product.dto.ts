import type { ProductCategory, ProductStatus, Unit } from '@prisma/client';
import type { ProductMetrics } from '../inventory/domain/index.js';
import type { LotDto } from '../inventory/inventory.dto.js';
import type { ProductRecord } from './product.repository.js';

/** Contract ProductDTO: stored fields plus the figures the server computes. */
export interface ProductDto extends ProductMetrics {
  id: string;
  name: string;
  category: ProductCategory;
  unit: Unit;
  minStock: number;
  status: ProductStatus;
  photoUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductDetailDto extends ProductDto {
  /** Lots with stock, ordered by expiry date (FEFO order). */
  lots: LotDto[];
}

export function toProductDto(product: ProductRecord, metrics: ProductMetrics): ProductDto {
  return {
    id: product.id,
    name: product.name,
    category: product.category,
    unit: product.unit,
    minStock: product.minStock.toNumber(),
    status: product.status,
    photoUrl: product.photoUrl,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
    ...metrics,
  };
}

import type { Prisma, ProductCategory, ProductStatus, Unit } from '@prisma/client';
import type { NewAuditLog } from '../audit/index.js';

export interface ProductRecord {
  id: string;
  name: string;
  category: ProductCategory;
  unit: Unit;
  /** Decimal(12,3); the service converts it to a JSON number. */
  minStock: Prisma.Decimal;
  status: ProductStatus;
  photoUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewProduct {
  id: string;
  name: string;
  category: ProductCategory;
  unit: Unit;
  minStock: number;
}

export interface ProductPatch {
  name?: string | undefined;
  category?: ProductCategory | undefined;
  unit?: Unit | undefined;
  minStock?: number | undefined;
  status?: ProductStatus | undefined;
}

export interface ProductFilter {
  /** Case-insensitive substring of the name. */
  search?: string | undefined;
  category?: ProductCategory | undefined;
  status?: ProductStatus | undefined;
}

/** Thrown by repositories when the unique product name is already taken. */
export class DuplicateProductNameError extends Error {
  constructor(public readonly productName: string) {
    super('A product with this name already exists');
    this.name = 'DuplicateProductNameError';
  }
}

export interface ProductRepository {
  findById(id: string): Promise<ProductRecord | null>;
  /** Case-insensitive exact match, optionally ignoring one product (for updates). */
  findByName(name: string, excludeId?: string): Promise<ProductRecord | null>;
  /** Ordered by name. Without `page` it returns every match. */
  list(
    filter: ProductFilter,
    page?: { skip: number; take: number },
  ): Promise<{ items: ProductRecord[]; total: number }>;
  /** Creates the product and its audit row in one transaction. */
  create(product: NewProduct, audit: NewAuditLog): Promise<ProductRecord>;
  /** Updates the product and writes its audit row in one transaction. */
  update(id: string, patch: ProductPatch, audit: NewAuditLog): Promise<ProductRecord>;
}

import type { CustomerStatus, CustomerType } from '@prisma/client';
import type { NewAuditLog } from '../audit/index.js';

export interface CustomerRecord {
  id: string;
  name: string;
  type: CustomerType;
  address: string;
  phone: string | null;
  email: string | null;
  status: CustomerStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewCustomer {
  id: string;
  name: string;
  type: CustomerType;
  address: string;
  phone: string | null;
  email: string | null;
}

/** Only the present fields change; null clears phone or email. */
export interface CustomerPatch {
  name?: string | undefined;
  type?: CustomerType | undefined;
  address?: string | undefined;
  phone?: string | null | undefined;
  email?: string | null | undefined;
  status?: CustomerStatus | undefined;
}

export interface CustomerFilter {
  /** Case-insensitive substring of the name. */
  search?: string | undefined;
  type?: CustomerType | undefined;
  status?: CustomerStatus | undefined;
}

export interface CustomerRepository {
  findById(id: string): Promise<CustomerRecord | null>;
  /** Ordered by name. */
  list(
    filter: CustomerFilter,
    page: { skip: number; take: number },
  ): Promise<{ items: CustomerRecord[]; total: number }>;
  /** Creates the customer and its audit row in one transaction. */
  create(customer: NewCustomer, audit: NewAuditLog): Promise<CustomerRecord>;
  /** Updates the customer and writes its audit row in one transaction. */
  update(id: string, patch: CustomerPatch, audit: NewAuditLog): Promise<CustomerRecord>;
}

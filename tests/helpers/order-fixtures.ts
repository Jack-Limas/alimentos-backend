import { randomUUID } from 'node:crypto';
import type { CustomerStatus, CustomerType } from '@prisma/client';
import type { CustomerRecord } from '../../src/modules/customers/customer.repository.js';
import { NOW, type InventoryTestContext } from './inventory-fixtures.js';

export function addCustomer(
  context: InventoryTestContext,
  input: { name?: string; type?: CustomerType; status?: CustomerStatus } = {},
): CustomerRecord {
  const customer: CustomerRecord = {
    id: randomUUID(),
    name: input.name ?? 'Supermercado Prueba',
    type: input.type ?? 'SUPERMARKET',
    address: 'Cra 7 # 45-12, Bogotá',
    phone: null,
    email: null,
    status: input.status ?? 'ACTIVE',
    createdAt: NOW,
    updatedAt: NOW,
  };
  context.repositories.customers.customers.set(customer.id, customer);
  return customer;
}

/** Audit actions written so far, oldest first. */
export function auditActions(context: InventoryTestContext): string[] {
  return context.repositories.auditLogs.entries.map((log) => log.action);
}

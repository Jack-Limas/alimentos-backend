import type { CustomerStatus, CustomerType } from '@prisma/client';
import type { CustomerRecord } from './customer.repository.js';

export interface CustomerDto {
  id: string;
  name: string;
  type: CustomerType;
  address: string;
  phone: string | null;
  email: string | null;
  status: CustomerStatus;
  createdAt: string;
  updatedAt: string;
}

export function toCustomerDto(customer: CustomerRecord): CustomerDto {
  return {
    id: customer.id,
    name: customer.name,
    type: customer.type,
    address: customer.address,
    phone: customer.phone,
    email: customer.email,
    status: customer.status,
    createdAt: customer.createdAt.toISOString(),
    updatedAt: customer.updatedAt.toISOString(),
  };
}

import { randomUUID } from 'node:crypto';
import { AUDIT_ACTIONS, buildAuditEntry } from '../audit/index.js';
import { AppError } from '../../shared/errors/index.js';
import type { Actor } from '../../shared/http/actor.js';
import { paginate, toSkipTake, type Paginated } from '../../shared/http/pagination.js';
import { toCustomerDto, type CustomerDto } from './customer.dto.js';
import type { CustomerRepository } from './customer.repository.js';
import type {
  CreateCustomerBody,
  CustomerListQuery,
  UpdateCustomerBody,
} from './customer.schemas.js';

export interface CustomerService {
  list(query: CustomerListQuery): Promise<Paginated<CustomerDto>>;
  get(id: string): Promise<CustomerDto>;
  create(input: CreateCustomerBody, actor: Actor): Promise<CustomerDto>;
  update(id: string, patch: UpdateCustomerBody, actor: Actor): Promise<CustomerDto>;
}

export interface CustomerServiceDeps {
  customers: CustomerRepository;
  newId?: () => string;
}

function notFound(id: string): AppError {
  return new AppError(404, 'NOT_FOUND', 'Customer not found', { customerId: id });
}

export function createCustomerService({
  customers,
  newId = randomUUID,
}: CustomerServiceDeps): CustomerService {
  return {
    async list(query) {
      const { items, total } = await customers.list(
        { search: query.search, type: query.type, status: query.status },
        toSkipTake(query),
      );
      return paginate(items.map(toCustomerDto), total, query);
    },

    async get(id) {
      const customer = await customers.findById(id);
      if (!customer) throw notFound(id);
      return toCustomerDto(customer);
    },

    async create(input, actor) {
      const id = newId();
      const created = await customers.create(
        { id, ...input, phone: input.phone ?? null, email: input.email ?? null },
        buildAuditEntry({
          userId: actor.userId,
          action: AUDIT_ACTIONS.CUSTOMER_CREATED,
          entity: 'Customer',
          entityId: id,
          metadata: { name: input.name, type: input.type },
          ip: actor.ip,
        }),
      );
      return toCustomerDto(created);
    },

    async update(id, patch, actor) {
      if (!(await customers.findById(id))) throw notFound(id);
      const updated = await customers.update(
        id,
        patch,
        buildAuditEntry({
          userId: actor.userId,
          action: AUDIT_ACTIONS.CUSTOMER_UPDATED,
          entity: 'Customer',
          entityId: id,
          // Field names only: phone and email are personal data.
          metadata: {
            fields: Object.keys(patch),
            ...(patch.status ? { status: patch.status } : {}),
          },
          ip: actor.ip,
        }),
      );
      return toCustomerDto(updated);
    },
  };
}

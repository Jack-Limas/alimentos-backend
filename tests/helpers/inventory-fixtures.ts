import { randomUUID } from 'node:crypto';
import type { ProductCategory, ProductStatus, Unit } from '@prisma/client';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import type { ProductRecord } from '../../src/modules/products/product.repository.js';
import { ADMIN, OPERATOR, bearer, buildAuthTestApp, login } from './auth-fixtures.js';
import { dec } from './in-memory-inventory.js';

/** 10:00 in Bogota on 2026-10-26: the business "today" of these tests. */
export const NOW = new Date('2026-10-26T15:00:00Z');
export const TODAY = '2026-10-26';

/** App with in-memory data, a fixed clock and access tokens for both roles. */
export async function buildInventoryTestApp() {
  const context = await buildAuthTestApp({ clock: () => NOW });
  const tokenOf = async (user: { email: string; password: string }) =>
    (await login(context.app, user)).json<{ accessToken: string }>().accessToken;
  return {
    ...context,
    adminToken: await tokenOf(ADMIN),
    operatorToken: await tokenOf(OPERATOR),
  };
}

export type InventoryTestContext = Awaited<ReturnType<typeof buildInventoryTestApp>>;

export function addProduct(
  context: InventoryTestContext,
  input: {
    name: string;
    category?: ProductCategory;
    unit?: Unit;
    minStock?: number;
    status?: ProductStatus;
  },
): ProductRecord {
  const product: ProductRecord = {
    id: randomUUID(),
    name: input.name,
    category: input.category ?? 'GRAINS_LEGUMES',
    unit: input.unit ?? 'KG',
    minStock: dec(input.minStock ?? 0),
    status: input.status ?? 'ACTIVE',
    photoUrl: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
  context.repositories.products.products.set(product.id, product);
  return product;
}

export function call(
  app: FastifyInstance,
  token: string,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
): Promise<LightMyRequestResponse> {
  return app.inject({
    method,
    url,
    headers: bearer(token),
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}

export function errorCode(res: LightMyRequestResponse): string {
  return res.json<{ error: { code: string } }>().error.code;
}

export { ADMIN, OPERATOR };

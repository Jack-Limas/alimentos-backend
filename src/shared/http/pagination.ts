import { z } from 'zod';

export const MAX_PAGE_SIZE = 100;

/** `?page=1&pageSize=20` from the contract (section 3). */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
}

/** Paginated list body: `{ data: [...], meta: { page, pageSize, total } }`. */
export interface Paginated<T> {
  data: T[];
  meta: PageMeta;
}

export function paginate<T>(data: T[], total: number, query: PaginationQuery): Paginated<T> {
  return { data, meta: { page: query.page, pageSize: query.pageSize, total } };
}

export function toSkipTake(query: PaginationQuery): { skip: number; take: number } {
  return { skip: (query.page - 1) * query.pageSize, take: query.pageSize };
}

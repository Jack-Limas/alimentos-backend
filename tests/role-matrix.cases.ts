/**
 * Every route of the API × {anonymous, OPERATOR, ADMIN} with the status each
 * one gets. The same table drives tests/role-matrix.test.ts (which sends the
 * requests and checks that no route is missing) and docs/role-matrix.md
 * (`npm run docs:role-matrix`).
 *
 * Requests are built so the answer depends only on the role: unknown ids give
 * 404, empty bodies give 400 and the AI service is not configured (503). A
 * 401/403 always comes before validation, so a role without access never
 * learns anything about the body or the resource.
 */

export type Who = 'anonymous' | 'OPERATOR' | 'ADMIN';
export type Method = 'GET' | 'POST' | 'PATCH';

export interface MatrixCase {
  method: Method;
  /** The route pattern, as Fastify registers it. */
  route: string;
  /** The concrete URL sent; defaults to the pattern. */
  url?: string;
  payload?: Record<string, unknown>;
  expected: Record<Who, number>;
  /** Why the allowed roles get that status (shown in the docs). */
  note?: string;
}

export const MISSING_ID = '00000000-0000-4000-8000-000000000000';
const id = (route: string) => route.replace(':id', MISSING_ID);

const ANY: Record<Who, number> = { anonymous: 200, OPERATOR: 200, ADMIN: 200 };
const SIGNED_IN = (status: number): Record<Who, number> => ({
  anonymous: 401,
  OPERATOR: status,
  ADMIN: status,
});
const ADMIN_ONLY = (status: number): Record<Who, number> => ({
  anonymous: 401,
  OPERATOR: 403,
  ADMIN: status,
});

export const ROLE_MATRIX: MatrixCase[] = [
  // Health (Render's health check uses the root /health)
  { method: 'GET', route: '/health', expected: ANY },
  { method: 'GET', route: '/api/v1/health', expected: ANY },
  { method: 'GET', route: '/api/v1/health/ready', expected: ANY },

  // Auth
  {
    method: 'POST',
    route: '/api/v1/auth/login',
    payload: { email: 'nobody@alimentaiq.test', password: 'Wrong-Pass-123!' },
    expected: { anonymous: 401, OPERATOR: 401, ADMIN: 401 },
    note: 'public; wrong credentials → 401',
  },
  {
    method: 'POST',
    route: '/api/v1/auth/refresh',
    expected: { anonymous: 401, OPERATOR: 401, ADMIN: 401 },
    note: 'needs the refresh cookie, not the Bearer token',
  },
  {
    method: 'POST',
    route: '/api/v1/auth/logout',
    expected: { anonymous: 204, OPERATOR: 204, ADMIN: 204 },
    note: 'idempotent',
  },
  { method: 'GET', route: '/api/v1/auth/me', expected: SIGNED_IN(200) },

  // Products
  { method: 'GET', route: '/api/v1/products', expected: SIGNED_IN(200) },
  {
    method: 'GET',
    route: '/api/v1/products/:id',
    expected: SIGNED_IN(404),
    note: 'unknown id',
  },
  {
    method: 'POST',
    route: '/api/v1/products',
    payload: {},
    expected: ADMIN_ONLY(400),
    note: 'empty body',
  },
  {
    method: 'PATCH',
    route: '/api/v1/products/:id',
    payload: { name: 'Arroz' },
    expected: ADMIN_ONLY(404),
    note: 'unknown id',
  },

  // Inventory
  { method: 'GET', route: '/api/v1/inventory/lots', expected: SIGNED_IN(200) },
  { method: 'GET', route: '/api/v1/inventory/summary', expected: SIGNED_IN(200) },
  { method: 'GET', route: '/api/v1/inventory/movements', expected: ADMIN_ONLY(200) },
  {
    method: 'POST',
    route: '/api/v1/inventory/entries',
    payload: {},
    expected: ADMIN_ONLY(400),
    note: 'empty body',
  },
  {
    method: 'POST',
    route: '/api/v1/inventory/exits',
    payload: {},
    expected: ADMIN_ONLY(400),
    note: 'empty body',
  },

  // Customers
  { method: 'GET', route: '/api/v1/customers', expected: ADMIN_ONLY(200) },
  {
    method: 'GET',
    route: '/api/v1/customers/:id',
    expected: ADMIN_ONLY(404),
    note: 'unknown id',
  },
  {
    method: 'POST',
    route: '/api/v1/customers',
    payload: {},
    expected: ADMIN_ONLY(400),
    note: 'empty body',
  },
  {
    method: 'PATCH',
    route: '/api/v1/customers/:id',
    payload: { name: 'Comedor' },
    expected: ADMIN_ONLY(404),
    note: 'unknown id',
  },

  // Orders
  { method: 'GET', route: '/api/v1/orders', expected: SIGNED_IN(200) },
  { method: 'GET', route: '/api/v1/orders/:id', expected: SIGNED_IN(404), note: 'unknown id' },
  {
    method: 'POST',
    route: '/api/v1/orders',
    payload: {},
    expected: ADMIN_ONLY(400),
    note: 'empty body',
  },
  {
    method: 'PATCH',
    route: '/api/v1/orders/:id/status',
    payload: { status: 'IN_PREPARATION' },
    expected: SIGNED_IN(404),
    note: 'both roles move orders; unknown id',
  },

  // Distribution
  { method: 'GET', route: '/api/v1/distribution/snapshot', expected: SIGNED_IN(200) },
  {
    method: 'POST',
    route: '/api/v1/distribution/proposals',
    payload: { strategy: 'NOT_A_STRATEGY' },
    expected: SIGNED_IN(400),
    note: 'invalid strategy',
  },
  { method: 'GET', route: '/api/v1/distribution/proposals', expected: SIGNED_IN(200) },
  {
    method: 'GET',
    route: '/api/v1/distribution/proposals/:id',
    expected: SIGNED_IN(404),
    note: 'unknown id',
  },
  {
    method: 'POST',
    route: '/api/v1/distribution/proposals/:id/confirm',
    expected: SIGNED_IN(404),
    note: 'unknown id',
  },
  {
    method: 'POST',
    route: '/api/v1/distribution/proposals/:id/discard',
    expected: SIGNED_IN(404),
    note: 'unknown id',
  },

  // Alerts
  { method: 'GET', route: '/api/v1/alerts', expected: SIGNED_IN(200) },

  // AI (the test app has no AI service configured)
  {
    method: 'POST',
    route: '/api/v1/ai/proposals/:id/explanation',
    payload: {},
    expected: SIGNED_IN(404),
    note: 'unknown proposal',
  },
  {
    method: 'POST',
    route: '/api/v1/ai/rescue-plan',
    payload: {},
    expected: ADMIN_ONLY(200),
    note: 'no lots at risk: answers without calling the AI',
  },
  {
    method: 'POST',
    route: '/api/v1/ai/briefing',
    payload: {},
    expected: SIGNED_IN(503),
    note: 'AI not configured',
  },

  // Reports, metrics, benchmark
  {
    method: 'GET',
    route: '/api/v1/reports/:kind',
    url: '/api/v1/reports/inventory',
    expected: ADMIN_ONLY(200),
  },
  { method: 'GET', route: '/api/v1/metrics/api', expected: ADMIN_ONLY(200) },
  {
    method: 'POST',
    route: '/api/v1/metrics/web-vitals',
    payload: { name: 'LCP', value: 1200, rating: 'good', page: '/app' },
    expected: SIGNED_IN(204),
  },
  { method: 'GET', route: '/api/v1/metrics/web-vitals', expected: ADMIN_ONLY(200) },
  { method: 'GET', route: '/api/v1/benchmarks/limits', expected: ADMIN_ONLY(200) },
  {
    method: 'POST',
    route: '/api/v1/benchmarks/worker-threads',
    payload: {},
    expected: ADMIN_ONLY(400),
    note: 'empty body (a real run is in benchmarks.test.ts)',
  },

  // Audit and administration
  { method: 'GET', route: '/api/v1/audit-logs', expected: ADMIN_ONLY(200) },
  { method: 'GET', route: '/api/v1/admin/network-info', expected: ADMIN_ONLY(200) },

  // Public
  { method: 'GET', route: '/api/v1/public/impact', expected: ANY },
];

export const urlOf = (entry: MatrixCase): string => entry.url ?? id(entry.route);

const WHO: Who[] = ['anonymous', 'OPERATOR', 'ADMIN'];

function cell(status: number): string {
  if (status === 401) return '401 ⛔';
  if (status === 403) return '403 🚫';
  return `${String(status)} ✅`;
}

/** docs/role-matrix.md, generated from ROLE_MATRIX. */
export function renderRoleMatrix(): string {
  const rows = ROLE_MATRIX.map(
    (entry) =>
      `| \`${entry.method}\` | \`${entry.route}\` | ${WHO.map((who) => cell(entry.expected[who])).join(' | ')} | ${entry.note ?? ''} |`,
  );
  const count = (predicate: (entry: MatrixCase) => boolean) => ROLE_MATRIX.filter(predicate).length;
  const adminOnly = count((e) => e.expected.OPERATOR === 403);
  const publicRoutes = count((e) => e.expected.anonymous !== 401);
  return [
    '# Matriz de roles',
    '',
    '> Generado con `npm run docs:role-matrix` desde `tests/role-matrix.cases.ts`. No editar a mano:',
    '> `tests/role-matrix.test.ts` envía cada petición y falla si una ruta falta o cambia su status.',
    '',
    `${String(ROLE_MATRIX.length)} rutas × 3 actores = ${String(ROLE_MATRIX.length * 3)} comprobaciones. ` +
      `${String(publicRoutes)} rutas responden sin sesión, ${String(adminOnly)} son solo ADMIN ` +
      `y el resto acepta ambos roles.`,
    '',
    'Leyenda: ⛔ 401 sin sesión · 🚫 403 rol sin permiso · ✅ el rol pasa la autorización (el status',
    'muestra la respuesta a la petición de prueba: 404 id inexistente, 400 cuerpo vacío, 503 IA no',
    'configurada). La autorización se evalúa antes que la validación: un rol sin permiso nunca ve',
    'errores del cuerpo ni la existencia del recurso.',
    '',
    '| Método | Ruta | Anónimo | OPERATOR | ADMIN | Petición de prueba |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
  ].join('\n');
}

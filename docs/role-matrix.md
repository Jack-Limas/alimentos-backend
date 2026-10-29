# Matriz de roles

> Generado con `npm run docs:role-matrix` desde `tests/role-matrix.cases.ts`. No editar a mano:
> `tests/role-matrix.test.ts` envía cada petición y falla si una ruta falta o cambia su status.

43 rutas × 3 actores = 129 comprobaciones. 5 rutas responden sin sesión, 18 son solo ADMIN y el resto acepta ambos roles.

Leyenda: ⛔ 401 sin sesión · 🚫 403 rol sin permiso · ✅ el rol pasa la autorización (el status
muestra la respuesta a la petición de prueba: 404 id inexistente, 400 cuerpo vacío, 503 IA no
configurada). La autorización se evalúa antes que la validación: un rol sin permiso nunca ve
errores del cuerpo ni la existencia del recurso.

| Método | Ruta | Anónimo | OPERATOR | ADMIN | Petición de prueba |
| --- | --- | --- | --- | --- | --- |
| `GET` | `/health` | 200 ✅ | 200 ✅ | 200 ✅ |  |
| `GET` | `/api/v1/health` | 200 ✅ | 200 ✅ | 200 ✅ |  |
| `GET` | `/api/v1/health/ready` | 200 ✅ | 200 ✅ | 200 ✅ |  |
| `POST` | `/api/v1/auth/login` | 401 ⛔ | 401 ⛔ | 401 ⛔ | public; wrong credentials → 401 |
| `POST` | `/api/v1/auth/refresh` | 401 ⛔ | 401 ⛔ | 401 ⛔ | needs the refresh cookie, not the Bearer token |
| `POST` | `/api/v1/auth/logout` | 204 ✅ | 204 ✅ | 204 ✅ | idempotent |
| `GET` | `/api/v1/auth/me` | 401 ⛔ | 200 ✅ | 200 ✅ |  |
| `GET` | `/api/v1/products` | 401 ⛔ | 200 ✅ | 200 ✅ |  |
| `GET` | `/api/v1/products/:id` | 401 ⛔ | 404 ✅ | 404 ✅ | unknown id |
| `POST` | `/api/v1/products` | 401 ⛔ | 403 🚫 | 400 ✅ | empty body |
| `PATCH` | `/api/v1/products/:id` | 401 ⛔ | 403 🚫 | 404 ✅ | unknown id |
| `GET` | `/api/v1/inventory/lots` | 401 ⛔ | 200 ✅ | 200 ✅ |  |
| `GET` | `/api/v1/inventory/summary` | 401 ⛔ | 200 ✅ | 200 ✅ |  |
| `GET` | `/api/v1/inventory/movements` | 401 ⛔ | 403 🚫 | 200 ✅ |  |
| `POST` | `/api/v1/inventory/entries` | 401 ⛔ | 403 🚫 | 400 ✅ | empty body |
| `POST` | `/api/v1/inventory/exits` | 401 ⛔ | 403 🚫 | 400 ✅ | empty body |
| `GET` | `/api/v1/customers` | 401 ⛔ | 403 🚫 | 200 ✅ |  |
| `GET` | `/api/v1/customers/:id` | 401 ⛔ | 403 🚫 | 404 ✅ | unknown id |
| `POST` | `/api/v1/customers` | 401 ⛔ | 403 🚫 | 400 ✅ | empty body |
| `PATCH` | `/api/v1/customers/:id` | 401 ⛔ | 403 🚫 | 404 ✅ | unknown id |
| `GET` | `/api/v1/orders` | 401 ⛔ | 200 ✅ | 200 ✅ |  |
| `GET` | `/api/v1/orders/:id` | 401 ⛔ | 404 ✅ | 404 ✅ | unknown id |
| `POST` | `/api/v1/orders` | 401 ⛔ | 403 🚫 | 400 ✅ | empty body |
| `PATCH` | `/api/v1/orders/:id/status` | 401 ⛔ | 404 ✅ | 404 ✅ | both roles move orders; unknown id |
| `GET` | `/api/v1/distribution/snapshot` | 401 ⛔ | 200 ✅ | 200 ✅ |  |
| `POST` | `/api/v1/distribution/proposals` | 401 ⛔ | 400 ✅ | 400 ✅ | invalid strategy |
| `GET` | `/api/v1/distribution/proposals` | 401 ⛔ | 200 ✅ | 200 ✅ |  |
| `GET` | `/api/v1/distribution/proposals/:id` | 401 ⛔ | 404 ✅ | 404 ✅ | unknown id |
| `POST` | `/api/v1/distribution/proposals/:id/confirm` | 401 ⛔ | 404 ✅ | 404 ✅ | unknown id |
| `POST` | `/api/v1/distribution/proposals/:id/discard` | 401 ⛔ | 404 ✅ | 404 ✅ | unknown id |
| `GET` | `/api/v1/alerts` | 401 ⛔ | 200 ✅ | 200 ✅ |  |
| `POST` | `/api/v1/ai/proposals/:id/explanation` | 401 ⛔ | 404 ✅ | 404 ✅ | unknown proposal |
| `POST` | `/api/v1/ai/rescue-plan` | 401 ⛔ | 403 🚫 | 200 ✅ | no lots at risk: answers without calling the AI |
| `POST` | `/api/v1/ai/briefing` | 401 ⛔ | 503 ✅ | 503 ✅ | AI not configured |
| `GET` | `/api/v1/reports/:kind` | 401 ⛔ | 403 🚫 | 200 ✅ |  |
| `GET` | `/api/v1/metrics/api` | 401 ⛔ | 403 🚫 | 200 ✅ |  |
| `POST` | `/api/v1/metrics/web-vitals` | 401 ⛔ | 204 ✅ | 204 ✅ |  |
| `GET` | `/api/v1/metrics/web-vitals` | 401 ⛔ | 403 🚫 | 200 ✅ |  |
| `GET` | `/api/v1/benchmarks/limits` | 401 ⛔ | 403 🚫 | 200 ✅ |  |
| `POST` | `/api/v1/benchmarks/worker-threads` | 401 ⛔ | 403 🚫 | 400 ✅ | empty body (a real run is in benchmarks.test.ts) |
| `GET` | `/api/v1/audit-logs` | 401 ⛔ | 403 🚫 | 200 ✅ |  |
| `GET` | `/api/v1/admin/network-info` | 401 ⛔ | 403 🚫 | 200 ✅ |  |
| `GET` | `/api/v1/public/impact` | 200 ✅ | 200 ✅ | 200 ✅ |  |

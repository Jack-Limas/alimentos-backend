# AlimentaIQ — Contrato de API (v1)

> Fuente de verdad del contrato entre `alimentos-frontend`, `alimentos-backend` y `alimentos-ai`.
> No hay código compartido entre repos: cada repo copia en su README la parte del contrato que consume o expone.
> Etiquetas: **[OBL]** obligatorio según enunciado o reglas de clase · **[EXTRA]** recortable si falta tiempo.

---

## 1. Arquitectura

```mermaid
flowchart LR
  subgraph Browser["Navegador (Next.js en Vercel)"]
    UI["UI React 19<br/>TanStack Query · next-intl"]
    WW["Web Worker<br/>motor de distribución"]
    POOL["Pool de Workers<br/>SharedArrayBuffer + Atomics"]
    SW["SharedWorker<br/>sondeo de alertas entre pestañas"]
    SVW["Service Worker<br/>app shell offline"]
    UI <-->|postMessage| WW
    UI <-->|SAB: progreso / cancelación| POOL
    UI <-->|MessagePort| SW
    SVW -.intercepta fetch.- UI
  end

  subgraph Next["Servidor Next (Vercel)"]
    SSG["SSG: landing, login"]
    ISR["ISR: /impact (revalidate 3600)"]
    SSR["SSR: hoja de despacho<br/>con enlace firmado [EXTRA]"]
  end

  subgraph API["alimentos-backend (Fastify en Render)"]
    R["routes → controllers"] --> S["services<br/>(Strategy de priorización)"] --> REPO["repositories (Prisma)"]
    WT["Worker Threads<br/>reportes y análisis masivo"]
    S --> WT
  end

  DB[("PostgreSQL · Neon<br/>rama main = producción<br/>rama bench = seed grande")]
  AI["alimentos-ai (Fastify en Render)<br/>X-Internal-Key · sin BD"]
  GEM["Gemini API"]
  CLD["Cloudinary [EXTRA]"]

  UI -->|HTTPS + cookie refresh + Bearer| API
  ISR -->|GET /public/impact| API
  SSR -->|GET /public/dispatch-sheets/:id?token| API
  REPO --> DB
  S -->|HTTP timeout + 1 reintento| AI
  AI --> GEM
  API --> CLD
```

## 2. Modelo de datos

```mermaid
erDiagram
  User ||--o{ RefreshToken : has
  User ||--o{ AuditLog : performs
  User ||--o{ InventoryMovement : records
  Product ||--o{ InventoryLot : stocked_as
  InventoryLot ||--o{ InventoryMovement : affected_by
  Customer ||--o{ Order : places
  Order ||--|{ OrderItem : contains
  Product ||--o{ OrderItem : requested_in
  Order ||--o{ OrderStatusHistory : tracks
  DistributionProposal ||--|{ ProposalLine : contains
  ProposalLine }o--|| OrderItem : allocates
  ProposalLine }o--o| InventoryLot : from_lot

  User { uuid id string email string passwordHash enum role bool active }
  RefreshToken { uuid id string tokenHash uuid familyId datetime expiresAt datetime revokedAt }
  LoginAttempt { uuid id string email string ip bool success datetime createdAt }
  AuditLog { uuid id uuid userId string action string entity string entityId json metadata }
  Product { uuid id string name enum category enum unit decimal minStock enum status string photoUrl }
  InventoryLot { uuid id uuid productId string lotCode decimal quantity date expiryDate datetime receivedAt }
  InventoryMovement { uuid id uuid lotId enum type decimal quantity string reason uuid orderId }
  Customer { uuid id string name enum type string address string phone string email enum status }
  Order { uuid id string code uuid customerId enum status enum priority datetime dueDate }
  OrderItem { uuid id uuid orderId uuid productId decimal requestedQty decimal allocatedQty }
  OrderStatusHistory { uuid id uuid orderId enum from enum to uuid userId string note }
  DistributionProposal { uuid id enum strategy enum status json weights int processingMs bool degraded }
  ProposalLine { uuid id uuid orderItemId uuid lotId decimal recommendedQty json reasons }
```

**Enums**

| Enum | Valores |
|---|---|
| `Role` | `ADMIN`, `OPERATOR` |
| `ProductCategory` | `FRUITS_VEGETABLES`, `DAIRY`, `MEAT_POULTRY`, `FISH`, `BAKERY`, `GRAINS_LEGUMES`, `CANNED`, `BEVERAGES`, `FROZEN`, `OTHER` |
| `Unit` | `KG`, `L`, `UNIT`, `BOX` (sin conversiones) |
| `ProductStatus` / `CustomerStatus` | `ACTIVE`, `INACTIVE` (no hay borrado físico) |
| `CustomerType` | `SUPERMARKET`, `RESTAURANT`, `SCHOOL`, `HOSPITAL`, `FOOD_BANK` |
| `OrderStatus` | `PENDING`, `IN_PREPARATION`, `READY_FOR_DISPATCH`, `SHIPPED`, `DELIVERED`, `CANCELLED` |
| `OrderPriority` | `LOW`, `MEDIUM`, `HIGH`, `URGENT` |
| `MovementType` | `ENTRY`, `EXIT_DISPATCH`, `EXIT_WASTE`, `ADJUSTMENT`, `RETURN` |
| `ProposalStatus` | `DRAFT`, `CONFIRMED`, `DISCARDED` |
| `Strategy` | `RULES`, `AI_ASSISTED` |

**Máquina de estados de `Order`**

```mermaid
stateDiagram-v2
  [*] --> PENDING
  PENDING --> IN_PREPARATION: confirmar propuesta (asigna lotes FEFO)
  IN_PREPARATION --> READY_FOR_DISPATCH
  READY_FOR_DISPATCH --> SHIPPED
  SHIPPED --> DELIVERED
  PENDING --> CANCELLED: solo ADMIN
  IN_PREPARATION --> CANCELLED: solo ADMIN (genera RETURN a los mismos lotes)
  READY_FOR_DISPATCH --> CANCELLED: solo ADMIN (genera RETURN)
```

---

## 3. Convenciones

- Base: `/api/v1`. JSON en `camelCase`. IDs `uuid`. Códigos legibles de pedido: `PED-000123`.
- Fechas: `datetime` en ISO 8601 UTC; `expiryDate` y `dueDate` como `YYYY-MM-DD`.
- Cantidades: `Decimal(12,3)` en BD, `number` en JSON.
- Lista paginada: `?page=1&pageSize=20` → `{ "data": [...], "meta": { "page", "pageSize", "total" } }`.
- Recurso único: `{ "data": {...} }`.
- Error: `{ "error": { "code": "STRING", "message": "texto", "details": {} } }`.
- Justificaciones y alertas viajan como **códigos + parámetros** (`{ "code": "EXPIRES_IN_DAYS", "params": { "days": 3 } }`); el frontend las traduce con next-intl. El backend nunca envía texto traducido.
- Cada respuesta incluye `Server-Timing: app;dur=<ms>` para las métricas de tiempo de API.
- El cliente **nunca envía cifras calculadas**: puntajes, cantidades recomendadas y alertas los recalcula siempre el servidor.

**Códigos de error**

| HTTP | `code` |
|---|---|
| 400 | `VALIDATION_ERROR` |
| 401 | `UNAUTHENTICATED`, `INVALID_CREDENTIALS`, `TOKEN_EXPIRED` |
| 403 | `FORBIDDEN` |
| 404 | `NOT_FOUND` |
| 409 | `INVALID_STATUS_TRANSITION`, `INSUFFICIENT_STOCK`, `STALE_PROPOSAL`, `DUPLICATE` |
| 429 | `TOO_MANY_REQUESTS` (incluye `Retry-After`) |
| 503 | `AI_UNAVAILABLE` (con `details.category`) |
| 500 | `INTERNAL_ERROR` (error inesperado; sin detalles internos en producción) |

---

## 4. Endpoints del backend

Roles: **A** = ADMIN, **O** = OPERATOR, **P** = público.

### 4.1 Salud — [OBL]
| Método | Ruta | Rol | Respuesta |
|---|---|---|---|
| GET | `/health` | P | `{ status: "ok", service, version, uptimeSec }` (sin BD; para ping y Render) |
| GET | `/health/ready` | P | `{ status: "ok", db: "up" }` o 503 `{ status: "degraded", db: "down" }` |

### 4.2 Autenticación — [OBL] (igual que ObraIQ)
| Método | Ruta | Rol | Cuerpo → Respuesta |
|---|---|---|---|
| POST | `/auth/login` | P | `{ email, password }` → `{ accessToken, user }` + `Set-Cookie: refresh_token` (HttpOnly, Secure, SameSite=None, Path=/api/v1/auth). 429 tras N intentos fallidos por email+IP |
| POST | `/auth/refresh` | P (cookie) | → `{ accessToken }` + cookie rotada. Reuso de un refresh revocado → se revoca toda la familia |
| POST | `/auth/logout` | cookie (sin Bearer) | revoca la familia del refresh de la cookie y la borra; responde 204 aunque no haya cookie |
| GET | `/auth/me` | A, O | `{ id, email, name, role }` |

El access token va en `Authorization: Bearer`; vive en memoria con copia en sessionStorage.

El access token es un JWT `{ sub, role }` firmado con `JWT_ACCESS_SECRET` (duración `ACCESS_TOKEN_TTL`). El refresh token es **opaco** (48 bytes aleatorios en base64url): en la BD solo se guarda su hash SHA-256, viaja únicamente en la cookie `refresh_token` y dura `REFRESH_TOKEN_TTL_DAYS`. Cada refresh lo rota dentro de la misma familia; presentar uno ya rotado revoca toda la familia.

### 4.3 Productos — [OBL]
| Método | Ruta | Rol | Notas |
|---|---|---|---|
| GET | `/products` | A, O | filtros: `search, category, status, stockStatus=LOW\|OUT, expiringWithinDays` |
| GET | `/products/:id` | A, O | incluye `lots[]` ordenados por `expiryDate` |
| POST | `/products` | A | `{ name, category, unit, minStock }` |
| PATCH | `/products/:id` | A | campos editables + `status` |
| POST | `/products/:id/photo` | A | multipart → Cloudinary **[EXTRA]** |

`ProductDTO` incluye campos calculados: `availableQty`, `nearestExpiry`, `stockStatus` (`OK\|LOW\|OUT`), `avgDailyOut30d`, `coverageDays`, `wasteRisk` (`NONE\|LOW\|HIGH`).

- `name` es único sin distinguir mayúsculas ni espacios al inicio o al final: un nombre repetido da 409 `DUPLICATE`. No hay borrado: se desactiva con `PATCH { status: "INACTIVE" }`.
- `POST` y `PATCH` rechazan con 400 los campos desconocidos, incluidos los calculados: el cliente nunca los envía.
- Campos calculados extra: `expiredQty` (stock en lotes ya vencidos) y `daysToNearestExpiry`.
- `reasons[]` explica `stockStatus` y `wasteRisk` con códigos y parámetros.
- `stockStatus` y `expiringWithinDays` se filtran después de calcular las métricas.

**Reglas de cálculo** (en el calendario de `APP_TIMEZONE`; un lote vence al terminar su `expiryDate`):

| Campo | Regla |
|---|---|
| `availableQty` | Suma de los lotes no vencidos |
| `nearestExpiry` | `expiryDate` más próximo entre los lotes no vencidos con stock |
| `stockStatus` | `OUT` si `availableQty = 0`; `LOW` si `< minStock`; si no, `OK` |
| `avgDailyOut30d` | `EXIT_DISPATCH` de los últimos 30 días / 30 |
| `coverageDays` | `availableQty / avgDailyOut30d`; `null` si el promedio es 0 |
| `wasteRisk` | `HIGH` si hay stock no vencido y (promedio = 0 y el lote más próximo vence en ≤ `EXPIRY_WARNING_DAYS`, o `coverageDays` > días hasta ese vencimiento); `LOW` si vence en ≤ `EXPIRY_WARNING_DAYS`; si no, `NONE` |

`EXPIRY_WARNING_DAYS = 7`.

**Códigos de `reasons[]`** (`{ code, params }`)

| `code` | `params` |
|---|---|
| `OUT_OF_STOCK` | `{ minStock }` |
| `BELOW_MIN_STOCK` | `{ availableQty, minStock }` |
| `EXPIRES_IN_DAYS` | `{ days }` |
| `NO_RECENT_OUTFLOW` | `{ windowDays }` |
| `COVERAGE_EXCEEDS_EXPIRY` | `{ coverageDays, daysToExpiry }` |
| `EXPIRED_STOCK` | `{ quantity }` |

### 4.4 Inventario — [OBL]
| Método | Ruta | Rol | Notas |
|---|---|---|---|
| GET | `/inventory/lots` | A, O | filtros: `productId, expiringWithinDays, includeExpired` |
| POST | `/inventory/entries` | A | `{ productId, quantity, expiryDate, lotCode?, note? }` → crea lote + movimiento `ENTRY` (transacción) |
| POST | `/inventory/exits` | A | `{ productId, quantity, type: EXIT_WASTE\|ADJUSTMENT, lotId?, reason }`; sin `lotId` consume FEFO |
| GET | `/inventory/movements` | A | filtros: `productId, type, from, to` |
| GET | `/inventory/summary` | A, O | `{ totalProducts, lowStock, outOfStock, expiringSoon, wasteRiskHigh }` |

- **Lotes** (`LotDTO`): `{ id, productId, lotCode, quantity, initialQuantity, expiryDate, receivedAt, daysToExpiry, expired }`. Solo se listan lotes con stock, ordenados por `expiryDate`. Por defecto se ocultan los vencidos (`includeExpired=true` los incluye) y `expiringWithinDays=N` limita a los que vencen hasta hoy + N.
- **Entrada**: 201 `{ data: { lot, movement } }`.
  - `quantity > 0` con hasta 3 decimales.
  - `expiryDate` no puede estar en el pasado.
  - Un producto inexistente da 404 y uno inactivo, 400.
  - Lote, movimiento `ENTRY` y auditoría se escriben en una sola transacción.
- **Salida**: 201 `{ data: { allocations: [{ lotId, qty }], movements } }`. `reason` es obligatorio.
  - **Con `lotId`**: usa ese lote. Si el lote no pertenece al producto, 404.
  - **Sin `lotId`**: aplica FEFO (ordena por vencimiento, después por recepción). Ignora los lotes vencidos salvo en `EXIT_WASTE`, que los consume primero.
  - Cada lote se descuenta con una actualización condicional (`quantity >= qty`) dentro de una transacción. Si el stock no alcanza, o si otra salida simultánea lo consumió, responde 409 `INSUFFICIENT_STOCK` y no queda ningún movimiento parcial.
- **Resumen**: cuenta solo productos `ACTIVE`. `lowStock` excluye los `OUT`. `expiringSoon` = productos cuyo lote más próximo vence en ≤ `EXPIRY_WARNING_DAYS`.
- Cantidades: `Decimal(12,3)` en BD, `number` en JSON. `InventoryMovement.quantity` siempre es positiva; el `type` da la dirección. `orderId` es FK opcional a `Order` (solo `EXIT_DISPATCH` y `RETURN` de un pedido).

### 4.5 Clientes — [OBL]
| Método | Ruta | Rol |
|---|---|---|
| GET | `/customers` | A |
| GET | `/customers/:id` | A |
| POST | `/customers` | A |
| PATCH | `/customers/:id` | A (incluye `status`) |

- `CustomerDTO`: `{ id, name, type, address, phone, email, status, createdAt, updatedAt }`. `phone` y `email` son opcionales; en PATCH, `null` los borra. El email se guarda en minúsculas.
- Filtros de `GET /customers`: `search` (nombre, sin distinguir mayúsculas), `type`, `status` y paginación. Orden por nombre.
- Sin borrado físico: se desactiva con `PATCH { "status": "INACTIVE" }`. Un cliente inactivo no puede recibir pedidos nuevos.
- La auditoría guarda los nombres de los campos cambiados, nunca el teléfono ni el email.

### 4.6 Pedidos — [OBL]
| Método | Ruta | Rol | Notas |
|---|---|---|---|
| GET | `/orders` | A, O | filtros: `status, priority, customerId, dueBefore` |
| GET | `/orders/:id` | A, O | incluye `items[]` y `history[]` |
| POST | `/orders` | A | `{ customerId, priority, dueDate, items: [{ productId, quantity }] }` |
| PATCH | `/orders/:id/status` | A, O | `{ status, note? }`; valida la máquina de estados; `CANCELLED` solo A |

- `OrderDTO`: `{ id, code, number, customer: { id, name, type }, status, priority, dueDate, notes, itemCount, createdById, createdAt, updatedAt }`. `code` (`PED-000123`) se deriva del `number` secuencial. El detalle agrega `items[]` (`{ id, productId, productName, unit, requestedQty, allocatedQty }`) e `history[]` (`{ id, fromStatus, toStatus, userId, note, createdAt }`).
- **Listado**: `status` admite varios (`?status=PENDING,IN_PREPARATION` o repetido), `priority`, `customerId` y `dueBefore` (estrictamente antes de esa fecha). Orden: `dueDate` asc, después `priority` (URGENT primero) y `number`.
- **Creación** (201 con el detalle):
  - Cliente inexistente 404; inactivo 400. Productos inexistentes 404 (`details.productIds`); inactivos 400.
  - Sin productos repetidos, 1–50 ítems, cantidades > 0 con hasta 3 decimales.
  - `dueDate` ≥ hoy en `APP_TIMEZONE`.
  - No reserva stock. Pedido, ítems, historial (`null → PENDING`) y auditoría van en una transacción.
- **Cambio de estado**:
  - Por PATCH se permiten `IN_PREPARATION → READY_FOR_DISPATCH → SHIPPED → DELIVERED` (A, O) y `→ CANCELLED` desde `PENDING`, `IN_PREPARATION` y `READY_FOR_DISPATCH` (solo A).
  - `PENDING → IN_PREPARATION` no se hace por PATCH: lo hace la confirmación de la propuesta de distribución (4.7). Responde 409 `INVALID_STATUS_TRANSITION` con `details.reason = REQUIRES_PROPOSAL`.
  - Una transición que no existe (incluido quedarse en el mismo estado) da 409 con `reason = NOT_ALLOWED`. Se revisa antes que el rol: un OPERATOR que cancela un pedido `SHIPPED` recibe 409, no 403. Un OPERATOR que cancela un pedido cancelable recibe 403 `FORBIDDEN`.
  - El estado se actualiza solo si sigue siendo el leído (`WHERE id AND status`). Si otro usuario lo cambió antes, 409 con `reason = STATUS_CHANGED` y no se escribe nada.
  - **Cancelar** devuelve a cada lote lo que el pedido despachó de él (`EXIT_DISPATCH` menos `RETURN` previos) con movimientos `RETURN` y deja `allocatedQty` en 0, todo en la misma transacción que el historial y la auditoría.

### 4.7 Distribución — [OBL]
| Método | Ruta | Rol | Notas |
|---|---|---|---|
| GET | `/distribution/snapshot` | A, O | pedidos `PENDING` + lotes vigentes + demanda 30 días. Alimenta el **Web Worker** para simular en el navegador |
| POST | `/distribution/proposals` | A, O | `{ strategy, weights? }` → el servidor recalcula y guarda `DRAFT` |
| GET | `/distribution/proposals` | A, O | listado |
| GET | `/distribution/proposals/:id` | A, O | líneas con `requestedQty, availableQty, recommendedQty, score, reasons[]` |
| POST | `/distribution/proposals/:id/confirm` | A, O | transacción: revalida stock (si cambió → 409 `STALE_PROPOSAL`), crea `EXIT_DISPATCH` FEFO, llena `allocatedQty`, pasa pedidos a `IN_PREPARATION` |
| POST | `/distribution/proposals/:id/discard` | A, O | |
| POST | `/distribution/proposals/:id/sheet-link` | A, O | **[EXTRA]** → `{ url, expiresAt }` (enlace firmado de 10 min) |

**Algoritmo (`RulesStrategy`), transparente y configurable**

```
score = wP·priority + wD·deadlineUrgency + wE·expiryPressure      (pesos por defecto 40 / 35 / 25)
priority        = LOW .25 · MEDIUM .5 · HIGH .75 · URGENT 1
deadlineUrgency = clamp(1 − díasHastaDueDate / 14, 0, 1)
expiryPressure  = máx sobre los ítems de clamp(1 − díasHastaVencimientoDelLoteFEFO / 30, 0, 1)
```

1. Pedidos `PENDING` → **min-heap** por `-score` (desempate: `dueDate`, luego antigüedad).
2. Por cada ítem: lotes del producto ordenados por `expiryDate` asc (**FEFO**), excluyendo vencidos o que vencen antes de `dueDate`.
3. `recommendedQty = min(requestedQty, disponibleRestante)`; los lotes se descuentan en un `Map<lotId, remaining>`.
4. Cada línea guarda `reasons[]`: `PRIORITY_URGENT`, `DUE_IN_DAYS`, `EXPIRES_IN_DAYS`, `PARTIAL_STOCK`, `NO_STOCK`.

`AI_ASSISTED`: ejecuta `RulesStrategy` y pide a la IA reordenar **solo empates** (|Δscore| < 2) y explicar. Si la IA falla → resultado de reglas con `degraded: true`.

> El mismo algoritmo existe en el backend y en el Web Worker del frontend (no hay código compartido). La paridad se verifica con los mismos fixtures en las pruebas de ambos repos.

### 4.8 Alertas — [OBL]
| Método | Ruta | Rol |
|---|---|---|
| GET | `/alerts` | A, O |

Se calculan al vuelo, no se guardan. Cada alerta: `{ type, severity: INFO|WARNING|CRITICAL, entity, entityId, code, params }`.

| `type` | Regla |
|---|---|
| `LOW_STOCK` | `availableQty < minStock` |
| `EXPIRING_SOON` | lote vence en ≤ `EXPIRY_WARNING_DAYS` (7) |
| `WASTE_RISK` | `coverageDays > díasHastaVencimiento` (baja rotación + vencimiento cercano) |
| `SHORTAGE_RISK` | demanda pendiente del producto > `availableQty` |
| `ORDER_DUE_SOON` | pedido no despachado con `dueDate` en ≤ 2 días |

### 4.9 IA (proxy del backend)
| Método | Ruta | Rol | Etiqueta |
|---|---|---|---|
| POST | `/ai/proposals/:id/explanation` | A, O | [OBL] |
| POST | `/ai/rescue-plan` | A | [OBL] productos con `WASTE_RISK` → acciones sugeridas |
| POST | `/ai/briefing` | A, O | [EXTRA] resumen del día |

El cliente solo envía IDs. El backend arma el contexto filtrado por rol. Si falla: 503 `AI_UNAVAILABLE` con `details.category`; la UI muestra el resultado de reglas.

### 4.10 Reportes y métricas
| Método | Ruta | Rol | Etiqueta |
|---|---|---|---|
| GET | `/reports/inventory?format=csv\|pdf` | A | [OBL] header `X-Generation-Time-Ms` |
| GET | `/reports/orders?from&to&format=csv\|pdf` | A | [OBL] |
| GET | `/reports/waste?format=csv\|pdf` | A | [OBL] |
| GET | `/metrics/api` | A | [OBL] p50/p95 por ruta (buffer circular en memoria) + `process.memoryUsage()` |
| POST | `/metrics/web-vitals` | A, O | [OBL] INP, LCP, TTFB enviados desde el frontend |
| POST | `/benchmarks/worker-threads` | A | [OBL] `{ size }` → `{ mainThreadMs, workerMs, eventLoopLagMain, eventLoopLagWorker }` |

### 4.11 Público
| Método | Ruta | Rol | Etiqueta |
|---|---|---|---|
| GET | `/public/impact` | P | [OBL] agregados sin datos personales (kg despachados, kg en riesgo rescatados, % entregas a tiempo); consumido por ISR |
| GET | `/public/dispatch-sheets/:id?token=` | P (token) | [EXTRA] consumido por SSR |

### 4.12 Administración
| Método | Ruta | Rol | Etiqueta |
|---|---|---|---|
| GET | `/audit-logs` | A | [OBL] |
| GET/POST/PATCH | `/users` | A | [EXTRA] (las cuentas salen del seed) |

---

## 5. Contrato backend → `alimentos-ai`

- Header `X-Internal-Key` (comparación timing-safe). Timeout 15 s, 1 reintento solo en `TIMEOUT` y `UPSTREAM_ERROR`.
- Modelo por variable `GEMINI_MODEL`. Salida JSON validada con Zod en ambos lados.

| Método | Ruta | Entrada (resumida) | Salida |
|---|---|---|---|
| GET | `/health` | — | `{ status, model }` |
| POST | `/v1/proposal-explanation` | `{ locale, role, lines: [{ orderCode, customerType, product, requestedQty, recommendedQty, score, reasons }] }` | `{ summary, highlights: string[], tieBreakOrder?: string[] }` |
| POST | `/v1/rescue-plan` | `{ locale, products: [{ name, category, qty, unit, daysToExpiry, avgDailyOut }], customerTypes }` | `{ actions: [{ product, action: DONATE\|REALLOCATE\|PRIORITIZE, rationale }] }` |
| POST | `/v1/briefing` [EXTRA] | `{ locale, role, alerts, pendingOrders, kpis }` | `{ summary, topActions: string[] }` |

**Errores de la IA** (`{ error: { code, category } }`): `MODEL_NOT_FOUND`, `QUOTA_EXCEEDED`, `TIMEOUT`, `UPSTREAM_ERROR`, `INVALID_API_KEY`, más `UNAUTHORIZED` (clave interna) y `VALIDATION_ERROR`.

---

## 6. Variables de entorno (sin valores)

| Repo | Variable | Uso |
|---|---|---|
| backend | `NODE_ENV`, `PORT` | Render inyecta `PORT`; local 4000 |
| backend | `DATABASE_URL`, `DIRECT_URL` | Neon (pooled / directa para migraciones) |
| backend | `JWT_ACCESS_SECRET`, `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL_DAYS` | Autenticación (refresh opaco: no necesita secreto) |
| backend | `LOGIN_MAX_ATTEMPTS`, `LOGIN_WINDOW_MINUTES` | Límite de intentos de login por email + IP |
| backend | `APP_TIMEZONE` | Zona IANA del calendario de negocio (por defecto `America/Bogota`): "hoy", días hasta el vencimiento y vencidos se calculan en esta zona |
| backend | `SHEET_LINK_SECRET` | Enlaces firmados [EXTRA] |
| backend | `CORS_ORIGINS` | Lista separada por comas |
| backend | `AI_SERVICE_URL`, `AI_INTERNAL_KEY`, `AI_TIMEOUT_MS` | Llamadas a la IA |
| backend | `CLOUDINARY_URL` | Fotos [EXTRA] |
| backend | `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_OPERATOR_EMAIL`, `SEED_OPERATOR_PASSWORD`, `SEED_SIZE` | Seed (sin valores por defecto; solo las valida el script de seed; `SEED_SIZE=large` solo en local o rama `bench`) |
| ai | `PORT`, `AI_INTERNAL_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL` | Solo este repo conoce la clave de Gemini |
| frontend | `NEXT_PUBLIC_API_URL`, `API_URL_INTERNAL` | URL del backend (cliente / servidor Next) |

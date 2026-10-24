# alimentos-backend

API REST de **AlimentaIQ — Centro Inteligente de Distribución de Alimentos**. Gestiona productos,
inventario por lotes (FEFO), clientes, pedidos, propuestas de distribución, alertas, reportes y
métricas, y actúa como proxy hacia el servicio de IA (`alimentos-ai`).

- Stack: Node 22 LTS · Fastify 5 · TypeScript estricto · Zod · Prisma 5 · PostgreSQL (Neon).
- Despliegue: Render (API) · Neon (base de datos).
- Contrato completo: [docs/api-contract.md](docs/api-contract.md). No hay código compartido con
  `alimentos-frontend` ni con `alimentos-ai`.

## Arquitectura

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

Capas del backend: `route → controller → service → repository (Prisma)`.

## Endpoints disponibles

| Método | Ruta                   | Respuesta                                                               |
| ------ | ---------------------- | ----------------------------------------------------------------------- |
| GET    | `/health`              | `{ status: "ok", service, version, uptimeSec }` (sin BD; Render)        |
| GET    | `/api/v1/health`       | Igual que `/health`                                                     |
| GET    | `/api/v1/health/ready` | `{ status: "ok", db: "up" }` o 503 `{ status: "degraded", db: "down" }` |

Todas las respuestas incluyen `Server-Timing: app;dur=<ms>`. Los errores siguen el formato
`{ "error": { "code", "message", "details" } }`.

## Requisitos

- Node 22 LTS (ver `.nvmrc`) y npm.
- Una base de datos PostgreSQL (rama `dev` de Neon para desarrollo).

## Puesta en marcha local

```bash
npm ci
cp .env.example .env   # y completa los valores
npx prisma generate
npx prisma migrate dev
npm run dev
curl -i http://localhost:4000/health
```

## Variables de entorno

Plantilla en [.env.example](.env.example). Nunca se commitean valores reales.

| Variable                 | Obligatoria | Uso                                                      |
| ------------------------ | ----------- | -------------------------------------------------------- |
| `NODE_ENV`               | Sí          | `development` · `test` · `production`                    |
| `PORT`                   | No          | Render lo inyecta; en local 4000 por defecto             |
| `DATABASE_URL`           | Sí          | Conexión pooled de Neon (la usa la app)                  |
| `DIRECT_URL`             | Sí          | Conexión directa de Neon (la usan las migraciones)       |
| `CORS_ORIGINS`           | Sí          | Orígenes permitidos separados por comas                  |
| `JWT_ACCESS_SECRET`      | Fase auth   | Firma del access token                                   |
| `JWT_REFRESH_SECRET`     | Fase auth   | Firma del refresh token                                  |
| `ACCESS_TOKEN_TTL`       | Fase auth   | Duración del access token                                |
| `REFRESH_TOKEN_TTL`      | Fase auth   | Duración del refresh token                               |
| `SHEET_LINK_SECRET`      | [EXTRA]     | Enlaces firmados de hoja de despacho                     |
| `AI_SERVICE_URL`         | Fase IA     | URL de `alimentos-ai`                                    |
| `AI_INTERNAL_KEY`        | Fase IA     | Clave enviada en `X-Internal-Key`                        |
| `AI_TIMEOUT_MS`          | Fase IA     | Timeout de las llamadas a la IA                          |
| `CLOUDINARY_URL`         | [EXTRA]     | Fotos de productos                                       |
| `SEED_ADMIN_PASSWORD`    | Seed        | Contraseña inicial del admin (sin valor por defecto)     |
| `SEED_OPERATOR_PASSWORD` | Seed        | Contraseña inicial del operador (sin valor por defecto)  |
| `SEED_SIZE`              | Seed        | `small` · `large` (`large` solo en local o rama `bench`) |

Si falta una variable obligatoria el servidor no arranca e indica cuál falta (sin mostrar valores).

## Scripts

| Script                 | Descripción                          |
| ---------------------- | ------------------------------------ |
| `npm run dev`          | Servidor en modo watch (`tsx watch`) |
| `npm run build`        | Compila TypeScript a `dist/`         |
| `npm start`            | Ejecuta `dist/server.js`             |
| `npm test`             | Pruebas con Vitest (no requieren BD) |
| `npm run lint`         | ESLint con reglas type-aware         |
| `npm run typecheck`    | `tsc --noEmit`                       |
| `npm run format`       | Formatea con Prettier                |
| `npm run format:check` | Verifica el formato (lo usa CI)      |

## Puertos

| Servicio             | Puerto local |
| -------------------- | ------------ |
| `alimentos-frontend` | 3000         |
| `alimentos-backend`  | 4000         |
| `alimentos-ai`       | 4100         |

## Migraciones

- Las migraciones se crean **solo** con `npx prisma migrate dev --name <nombre>` contra la rama
  `dev` de Neon (la que apunta tu `.env` local).
- Son **solo aditivas**: no se editan migraciones ya commiteadas ni se borran columnas o tablas en uso.
- Se aplican a producción **manualmente, desde local y antes de desplegar**:

```bash
DATABASE_URL=<main> DIRECT_URL=<main> npx prisma migrate deploy
```

donde `<main>` son las cadenas de conexión de la rama `main` de Neon (nunca se commitean).
Render no ejecuta migraciones.

## Despliegue en Render

| Ajuste        | Valor                                                          |
| ------------- | -------------------------------------------------------------- |
| Build Command | `npm ci --include=dev && npx prisma generate && npm run build` |
| Start Command | `npm start`                                                    |
| Health Check  | `/health`                                                      |
| `PORT`        | No se define: Render lo inyecta                                |

Las variables de entorno se configuran en el panel de Render.

## Autenticación (fase posterior)

El frontend vive en `*.vercel.app` y la API en `*.onrender.com` (sitios distintos, sin dominio
propio). Por eso el refresh token irá en una cookie `HttpOnly; Secure; SameSite=None;
Path=/api/v1/auth`, con el access token en `Authorization: Bearer` como respaldo. CORS usa una
allowlist (`CORS_ORIGINS`) con `credentials: true`.

## CI

GitHub Actions en cada push y PR a `main`: `npm ci`, `npx prisma generate`, lint, formato,
typecheck, pruebas y build. Las pruebas no necesitan base de datos.

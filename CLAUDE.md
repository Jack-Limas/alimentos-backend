# CLAUDE.md — alimentos-backend

Conventions for anyone (human or AI assistant) working in this repository.

## Project

- Backend of AlimentaIQ (Intelligent Food Distribution Center). Sibling repos `alimentos-frontend`
  and `alimentos-ai` share **no code** with this one.
- `docs/api-contract.md` is the source of truth for endpoints, data model, error codes and env
  variables. Do not change it from this repo without agreement across the three repos.
- Stack: Node 22 LTS, Fastify 5, strict TypeScript (ESM, `NodeNext`), Zod, Prisma 5, PostgreSQL
  on Neon. Deployed on Render.

## Code

- Code, identifiers, comments, commit messages and log messages in **English**. User-facing docs
  (README) in Spanish.
- Layers: `route → controller → service → repository`. Routes only wire HTTP; controllers map
  request/response; services hold business rules; repositories are the only layer that talks to
  Prisma.
- Each module lives in `src/modules/<name>/` with `<name>.routes.ts`, `<name>.controller.ts`,
  `<name>.service.ts`, `<name>.repository.ts` and an `index.ts` barrel.
- Dependencies are injected through factory functions (`createXService(deps)`) so tests can use
  fakes. `buildApp(deps)` in `src/app.ts` is the composition root; tests never touch a real DB.
- Validate every input with Zod. The client never sends computed values (scores, recommended
  quantities, alerts); the server always recomputes them.
- Relative imports use the `.js` extension (ESM output).

## Inventory rules

- Business logic that can be pure lives in `src/modules/<name>/domain/` (no Prisma, no clock) and
  is fully unit tested. Services pass "today" in.
- "Today" and days to expiry come from `todayIn(APP_TIMEZONE, clock())` and the calendar helpers,
  never from `new Date().toISOString()` (that is the UTC date).
- Quantities are `Decimal(12,3)` in the DB and numbers in JSON; do arithmetic with the milli-unit
  helpers (`toMilli`, `sumQty`), never by adding floats.
- Stock changes are movements with a positive quantity. Writes that change stock run in one
  transaction together with their audit row; decrements are conditional (`quantity >= qty`).
- Thresholds live in `INVENTORY_RULES`; do not hardcode 7 or 30 elsewhere.

## Order and alert rules

- Order transitions come only from `ORDER_TRANSITIONS` / `checkManualTransition`. Check the edge
  before the role (409 before 403). `PENDING -> IN_PREPARATION` belongs to proposal confirmation.
- Status updates are conditional (`WHERE id AND status = <read status>`); a lost race is a 409
  and must leave no partial writes.
- Cancelling returns stock with `RETURN` movements to the same lots, in the same transaction as the
  status change, history and audit.
- Alerts are computed on the fly with `buildAlerts`, reusing `productMetrics`; thresholds live in
  `ALERT_RULES`. Fetch aggregates (groupBy) and join them with a `Map`, never one query per row.
- Audit metadata never stores customer phone numbers or emails.

## Distribution rules

- The engine (`src/modules/distribution/domain/`) is pure and deterministic; inject `now` for
  `processingMs`. Any change to scoring, tie-breaking or lot eligibility must update the parity
  fixtures in `tests/fixtures/distribution-parity/` (and the frontend copy).
- A lot is dispatchable only if it expires tomorrow or later (`MIN_DAYS_TO_DISPATCH`).
- The server never accepts plan figures from the client: only `{ strategy, weights?, locale? }`.
- Confirmation is one transaction of conditional updates; any mismatch is a 409 `STALE_PROPOSAL`
  with nothing written.

## AI rules

- Only `src/modules/ai/` talks to `alimentos-ai`, through `AiClient` → `AiGateway` (the gateway
  writes the `AI_REQUESTED` audit row: endpoint, category, latency; never prompts or answers).
- The AI is optional: missing `AI_SERVICE_URL` / `AI_INTERNAL_KEY` means `NOT_CONFIGURED`, never a
  crash. AI failures surface as 503 `AI_UNAVAILABLE` with `details.category` (`AiError.toAppError`),
  except in `AI_ASSISTED`, which falls back to `BALANCED` with `degraded: true`.
- AI inputs are built in `ai-context.ts` from database data: customers travel as their type, never
  name, email or phone. Respect the alimentos-ai limits (200 items, 120 characters).
- The AI may only reorder tied orders (`findTieGroups`, |Δscore| < 2) via `tieBreakRanks`; the
  engine stays pure and synchronous.
- Retry only `TIMEOUT`, `UPSTREAM_ERROR` and network errors; respect the `QUOTA_EXCEEDED` cool-down.
- Never log or document the value of `AI_INTERNAL_KEY`; tests use a fake `fetch`, never the real
  service.

## Worker threads, reports and metrics

- CPU-heavy work (report formatting, the benchmark analysis) runs in the `worker_threads` pool
  (`src/workers/`); database reads stay on the main thread and only plain data crosses to the
  worker (no classes, no Prisma objects, no Dates).
- Add a task to `src/workers/tasks.ts` (typed in `Tasks`). Worker code must run both from
  `src/*.ts` (tsx bootstrap) and from `dist/*.js`; never hardcode one extension.
- CSV output always goes through `toCsv` (BOM, locale separator, escaping, CSV injection guard).
- Metrics are keyed by route pattern (`request.routeOptions.url`), never by the URL with IDs.
- Public endpoints return aggregates only: no names, ids, emails or phones; keep their cache
  headers and rate limit.
- The main-thread half of the benchmark blocks the server on purpose: keep the size cap and the
  one-at-a-time lock.

## Errors

- Response format: `{ "error": { "code": "STRING", "message": "text", "details": {} } }`.
- Throw `AppError(statusCode, code, message, details?)` with a code from
  `src/shared/errors/error-codes.ts` (contract, section 3). Zod errors become 400
  `VALIDATION_ERROR` automatically.
- Never expose stack traces or internal messages when `NODE_ENV=production`.
- Explanations and alerts travel as `{ code, params }`; the backend never sends translated text.

## Database and migrations

- Migrations are created only with `npx prisma migrate dev --name <name>` against the Neon `dev`
  branch, and are **additive only**: never edit a committed migration, never drop columns or
  tables in use.
- Production gets migrations manually, from local, before deploying:
  `DATABASE_URL=<main> DIRECT_URL=<main> npx prisma migrate deploy`.
- Migration `.sql` files are committed with LF line endings (see `.gitattributes`).

## Dependencies

- Exact versions only (no `^` or `~`); `.npmrc` enforces `save-exact`. Use npm and commit
  `package-lock.json`.
- Do not add dependencies outside the current phase's plan.

## Secrets

- Never commit secrets: `.env`, `.env.*` (except `.env.example`), `cookies.txt`, `*.pem` are
  ignored. `.env.example` lists names only, never values.
- Never print secrets to the terminal or logs. The logger redacts `authorization`, `cookie` and
  `set-cookie`.
- No real URLs, connection strings or keys in code, docs or this file.

## Commits

- Many small commits: one per logical piece (a file or a very small group of related files).
  Never one giant commit.
- Conventional Commits: `feat`, `fix`, `chore`, `test`, `docs`, `ci`, `refactor`, with an optional
  scope, e.g. `feat(health): add readiness endpoint`.
- Messages in English, imperative mood, specific.
- Every commit must leave the repo coherent: it compiles, lint and tests pass, nothing earlier
  breaks.
- Authorship is the repo owner's only: no `Co-Authored-By` or tool attribution lines.

## Checks before committing

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

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

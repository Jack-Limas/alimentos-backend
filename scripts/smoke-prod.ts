// Smoke test of a deployed AlimentaIQ:
//   npm run smoke:prod            → API checks (table PASS/WARN/FAIL, exit 1 on FAIL)
//   npm run smoke:prod -- --warm  → wake the backend, the AI and the frontend first
// Reads SMOKE_BASE_URL, SMOKE_FRONTEND_ORIGIN, SMOKE_AI_URL (warm only) and the
// demo credentials (SMOKE_ADMIN_EMAIL/PASSWORD, SMOKE_OPERATOR_EMAIL/PASSWORD,
// falling back to SEED_*) from the environment. Never prints them.
import dotenv from 'dotenv';
import { exitCodeOf, renderResults, runSmoke, warmUp, type WarmTarget } from './smoke/smoke.js';

const out = (line: string) => process.stdout.write(`${line}\n`);

function env(name: string, fallback?: string): string | undefined {
  const value = process.env[name]?.trim();
  if (value) return value;
  const other = fallback ? process.env[fallback]?.trim() : undefined;
  return other === '' ? undefined : other;
}

const origin = (value: string | undefined) => value?.replace(/\/+$/, '');

async function main(): Promise<number> {
  dotenv.config({ quiet: true });
  const baseUrl = origin(env('SMOKE_BASE_URL'));
  const frontendOrigin = origin(env('SMOKE_FRONTEND_ORIGIN'));

  if (process.argv.includes('--warm')) {
    const targets: WarmTarget[] = [];
    if (baseUrl) targets.push({ name: 'backend /health', url: `${baseUrl}/health` });
    const ai = origin(env('SMOKE_AI_URL'));
    if (ai) targets.push({ name: 'ai /health', url: `${ai}/health` });
    if (frontendOrigin) targets.push({ name: 'frontend /es', url: `${frontendOrigin}/es` });
    if (targets.length === 0) {
      out('smoke:prod --warm needs SMOKE_BASE_URL, SMOKE_AI_URL and/or SMOKE_FRONTEND_ORIGIN.');
      return 1;
    }
    out(`Warming ${targets.map((t) => t.name).join(', ')} (up to 3 minutes)…`);
    const results = await warmUp(targets);
    out(renderResults(results));
    return exitCodeOf(results);
  }

  const admin = {
    email: env('SMOKE_ADMIN_EMAIL', 'SEED_ADMIN_EMAIL'),
    password: env('SMOKE_ADMIN_PASSWORD', 'SEED_ADMIN_PASSWORD'),
  };
  const operator = {
    email: env('SMOKE_OPERATOR_EMAIL', 'SEED_OPERATOR_EMAIL'),
    password: env('SMOKE_OPERATOR_PASSWORD', 'SEED_OPERATOR_PASSWORD'),
  };
  const missing = [
    ['SMOKE_BASE_URL', baseUrl],
    ['SMOKE_FRONTEND_ORIGIN', frontendOrigin],
    ['SMOKE_ADMIN_EMAIL', admin.email],
    ['SMOKE_ADMIN_PASSWORD', admin.password],
    ['SMOKE_OPERATOR_EMAIL', operator.email],
    ['SMOKE_OPERATOR_PASSWORD', operator.password],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0 || !baseUrl || !frontendOrigin) {
    out(`smoke:prod: missing ${missing.join(', ')}`);
    return 1;
  }

  out(`smoke:prod against ${baseUrl} (frontend origin ${frontendOrigin})`);
  const results = await runSmoke({
    baseUrl,
    frontendOrigin,
    admin: { email: admin.email ?? '', password: admin.password ?? '' },
    operator: { email: operator.email ?? '', password: operator.password ?? '' },
  });
  out(renderResults(results));
  return exitCodeOf(results);
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    out(`smoke:prod failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });

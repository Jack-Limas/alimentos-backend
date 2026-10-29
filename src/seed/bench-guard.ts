/**
 * Safety checks of `npm run seed:bench`. The large seed writes tens of
 * thousands of rows, so it runs only when the operator names the database
 * host explicitly and never in production.
 */
export type BenchRefusal =
  'PRODUCTION' | 'MISSING_CONFIRM_HOST' | 'INVALID_DATABASE_URL' | 'HOST_MISMATCH';

export type BenchTarget =
  { ok: true; host: string } | { ok: false; reason: BenchRefusal; host?: string };

/** Reads `--confirm-host=<host>` (or `--confirm-host <host>`) from the CLI arguments. */
export function parseConfirmHost(argv: readonly string[]): string | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    const value = arg.startsWith('--confirm-host=')
      ? arg.slice('--confirm-host='.length).trim()
      : arg === '--confirm-host'
        ? (argv[i + 1]?.trim() ?? '')
        : null;
    // An empty value is the same as no value.
    if (value !== null) return value === '' ? undefined : value;
  }
  return undefined;
}

/** Only the host name of a connection URL: never the user, password or database. */
export function hostOf(databaseUrl: string | undefined): string | null {
  if (!databaseUrl) return null;
  try {
    return new URL(databaseUrl).hostname || null;
  } catch {
    return null;
  }
}

export function checkBenchTarget({
  databaseUrl,
  confirmHost,
  nodeEnv,
}: {
  databaseUrl: string | undefined;
  confirmHost: string | undefined;
  nodeEnv: string | undefined;
}): BenchTarget {
  if (nodeEnv === 'production') return { ok: false, reason: 'PRODUCTION' };
  const host = hostOf(databaseUrl);
  if (!host) return { ok: false, reason: 'INVALID_DATABASE_URL' };
  if (!confirmHost) return { ok: false, reason: 'MISSING_CONFIRM_HOST', host };
  if (confirmHost.toLowerCase() !== host.toLowerCase())
    return { ok: false, reason: 'HOST_MISMATCH', host };
  return { ok: true, host };
}

export const REFUSAL_MESSAGES: Readonly<Record<BenchRefusal, string>> = {
  PRODUCTION: 'Refusing to run with NODE_ENV=production.',
  MISSING_CONFIRM_HOST:
    'Pass --confirm-host=<host of DATABASE_URL> to confirm the target database.',
  INVALID_DATABASE_URL: 'DATABASE_URL is missing or is not a valid URL.',
  HOST_MISMATCH: '--confirm-host does not match the host of DATABASE_URL.',
};

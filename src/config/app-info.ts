import { readFileSync } from 'node:fs';

export interface AppInfo {
  name: string;
  version: string;
}

/**
 * Reads name and version from package.json. The relative URL resolves to the
 * repo root both from src/config (tsx) and dist/config (compiled build).
 */
export function readAppInfo(): AppInfo {
  const raw = readFileSync(new URL('../../package.json', import.meta.url), 'utf8');
  const pkg = JSON.parse(raw) as Partial<AppInfo>;
  return {
    name: pkg.name ?? 'alimentos-backend',
    version: pkg.version ?? '0.0.0',
  };
}

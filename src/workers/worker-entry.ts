/** Where a worker script is and how Node must start it. */
export interface WorkerEntry {
  url: URL;
  execArgv: string[];
}

/**
 * Resolves a worker script next to `fromUrl` (pass `import.meta.url`).
 * - Development and tests run the TypeScript sources (tsx, vitest): the
 *   caller is a `.ts` file, so the worker is `<name>.ts` and the thread is
 *   started with `--import tsx` to understand TypeScript.
 * - Production runs the compiled `dist/**.js`: the worker is `<name>.js` and
 *   plain Node runs it.
 */
export function resolveWorkerEntry(fromUrl: string, name: string): WorkerEntry {
  const fromTypeScript = new URL(fromUrl).pathname.endsWith('.ts');
  return fromTypeScript
    ? { url: new URL(`./${name}.ts`, fromUrl), execArgv: ['--import', 'tsx'] }
    : { url: new URL(`./${name}.js`, fromUrl), execArgv: [] };
}

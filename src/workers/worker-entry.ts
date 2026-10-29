/** Where a worker script is and how Node must start it. */
export interface WorkerEntry {
  url: URL;
  execArgv: string[];
  workerData?: { entry: string };
}

const BOOTSTRAP = new URL('./tsx-bootstrap.ts', import.meta.url);

/**
 * Resolves a worker script next to `fromUrl` (pass `import.meta.url`).
 * - Development and tests run the TypeScript sources (tsx, vitest): the
 *   caller is a `.ts` file, so the thread starts tsx-bootstrap.ts (built-in
 *   type stripping), which registers tsx and imports `<name>.ts`.
 * - Production runs the compiled `dist/**.js`: plain Node runs `<name>.js`.
 */
export function resolveWorkerEntry(fromUrl: string, name: string): WorkerEntry {
  const fromTypeScript = new URL(fromUrl).pathname.endsWith('.ts');
  return fromTypeScript
    ? {
        url: BOOTSTRAP,
        execArgv: ['--experimental-strip-types', '--disable-warning=ExperimentalWarning'],
        workerData: { entry: new URL(`./${name}.ts`, fromUrl).href },
      }
    : { url: new URL(`./${name}.js`, fromUrl), execArgv: [] };
}

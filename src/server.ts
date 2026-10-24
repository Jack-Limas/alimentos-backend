import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';

const SHUTDOWN_SIGNALS = ['SIGTERM', 'SIGINT'] as const;

async function main(): Promise<void> {
  const env = loadEnv();
  const app = await buildApp({ env });

  let shuttingDown = false;
  for (const signal of SHUTDOWN_SIGNALS) {
    process.once(signal, () => {
      if (shuttingDown) return;
      shuttingDown = true;
      app.log.info({ signal }, 'Shutting down gracefully');
      app.close().then(
        () => process.exit(0),
        (error: unknown) => {
          app.log.error({ err: error }, 'Error during shutdown');
          process.exit(1);
        },
      );
    });
  }

  // Render injects PORT; locally it defaults to 4000 (validated in env.ts).
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
}

main().catch((error: unknown) => {
  process.stderr.write(`Failed to start server: ${String(error)}\n`);
  process.exit(1);
});

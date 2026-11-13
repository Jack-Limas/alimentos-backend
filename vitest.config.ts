import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    passWithNoTests: true,
    restoreMocks: true,
    // Every file builds a Fastify app (plugins, bcrypt, worker pool); under a full parallel
    // run on a busy machine the first test of a file can take longer than the 5 s default.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});

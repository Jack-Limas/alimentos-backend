import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(import.meta.dirname, '..', 'prisma', 'migrations');

const sqlFiles = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(entry.name, 'migration.sql'));

describe('Prisma migrations', () => {
  it('exist', () => {
    expect(sqlFiles.length).toBeGreaterThan(0);
  });

  // Prisma checksums the SQL: CRLF on Windows vs LF in CI would look like a modified migration.
  it.each(sqlFiles)('%s uses LF line endings', (file) => {
    const content = readFileSync(join(migrationsDir, file));

    expect(content.includes(0x0d)).toBe(false);
  });
});

// Writes docs/role-matrix.md from the table tests/role-matrix.test.ts checks.
import { writeFileSync } from 'node:fs';
import { renderRoleMatrix } from '../tests/role-matrix.cases.js';

writeFileSync(new URL('../docs/role-matrix.md', import.meta.url), renderRoleMatrix());
process.stdout.write('docs/role-matrix.md written\n');

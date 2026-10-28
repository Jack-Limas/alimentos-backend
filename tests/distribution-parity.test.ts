import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildProposal,
  createStrategy,
  type DistributionSnapshot,
  type StrategyName,
  type Weights,
} from '../src/modules/distribution/domain/index.js';

// The frontend Web Worker has its own copy of the engine (no shared code). Both
// repos run these same files: equal output proves both engines agree.
const dir = join(import.meta.dirname, 'fixtures', 'distribution-parity');

interface ParityFixture {
  description: string;
  strategy: StrategyName;
  weights?: Weights;
  snapshot: DistributionSnapshot;
  expected: Record<string, unknown>;
}

const fixtures = readdirSync(dir)
  .filter((file) => file.endsWith('.json'))
  .sort()
  .map(
    (file) => [file, JSON.parse(readFileSync(join(dir, file), 'utf8')) as ParityFixture] as const,
  );

describe('distribution parity fixtures', () => {
  it('has at least three cases, one per rule strategy', () => {
    expect(new Set(fixtures.map(([, f]) => f.strategy))).toEqual(
      new Set(['BALANCED', 'URGENCY_FIRST', 'WASTE_FIRST']),
    );
  });

  it.each(fixtures)('%s matches the expected plan', (_file, fixture) => {
    const result = buildProposal(
      fixture.snapshot,
      createStrategy(fixture.strategy, fixture.weights),
      {
        now: () => 0,
      },
    );
    const { processingMs: _ms, ...summary } = result.summary;
    expect({ ranking: result.ranking, lines: result.lines, summary }).toEqual(fixture.expected);
  });
});

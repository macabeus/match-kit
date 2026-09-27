// Every engine handle a call mints is released before it returns, whether it scores or throws.
// Counted, because the engine tolerates far more leaked handles than a test can create.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

import { type Engine, createScorer, loadEngine } from '../src/index.js';

const read = (relative: string) => new Uint8Array(readFileSync(join(import.meta.dirname, 'fixtures', relative)));
const real = await loadEngine();

/** The real engine, with every handle it mints counted until its dispose runs. */
function tracked(): { engine: Engine; live: Set<object> } {
  const live = new Set<object>();
  const track = <T extends object | undefined>(h: T): T => {
    if (h) {
      live.add(h);
      const dispose = (h as unknown as Record<symbol, () => void>)[Symbol.dispose]!.bind(h);
      Object.defineProperty(h, Symbol.dispose, {
        value: () => {
          live.delete(h);
          dispose();
        },
      });
    }
    return h;
  };
  const engine = {
    ...real,
    version: real.version,
    diff: {
      ...real.diff,
      DiffConfig: function DiffConfig() {
        return track(new real.diff.DiffConfig());
      },
      Object: {
        ...real.diff.Object,
        parse: (...a: Parameters<typeof real.diff.Object.parse>) => track(real.diff.Object.parse(...a)),
      },
      runDiff: (...a: Parameters<typeof real.diff.runDiff>) => {
        const r = real.diff.runDiff(...a);
        track(r.left);
        track(r.right);
        return r;
      },
    },
  };
  return { engine: engine as unknown as Engine, live };
}

const cases: Array<[string, () => Uint8Array, string]> = [
  ['a score', () => read('edge/candidate-diff.o'), 'add_one'],
  ['a missing symbol in the target', () => read('edge/candidate-diff.o'), 'no_such_symbol'],
  ['a missing symbol in the candidate', () => read('edge/cpp-method.candidate.o'), 'add_one'],
  ['a row the engine cannot display', () => read('edge/candidate-odd-size.o'), 'add_one'],
  ['a symbol with zero rows', () => read('edge/zero-rows.o'), 'empty_fn'],
  ['a candidate that does not parse', () => new TextEncoder().encode('not an object'), 'add_one'],
];

test.each(cases)('%s leaves nothing behind', (_name, candidate, symbol) => {
  const { engine, live } = tracked();
  const scorer = createScorer(engine);
  const target = scorer.parseTarget(read(symbol === 'empty_fn' ? 'edge/zero-rows.o' : 'edge/target.o'));
  const before = live.size;
  for (const walk of [scorer.score, scorer.inspect]) {
    try {
      walk(target, candidate(), symbol);
    } catch {
      // Most cases throw; what matters is what the call leaves behind.
    }
    expect(live.size).toBe(before);
  }
  target.dispose();
  scorer.dispose();
  expect(live.size).toBe(0);
});

test('an invalid diffSetting leaves nothing behind', () => {
  const { engine, live } = tracked();
  expect(() => createScorer(engine, { diffSettings: { bogusKey: 'x' } })).toThrow(/invalid diffSettings/);
  expect(live.size).toBe(0);
});

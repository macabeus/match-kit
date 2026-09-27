// Every engine handle a call mints is released before it returns, on every path, success or throw.
// The real engine runs hundreds of thousands of undisposed calls before it fails, so a loop cannot
// prove this; counting the handles can.
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

const cases: Array<[string, string, string]> = [
  ['a score', 'edge/candidate-diff.o', 'add_one'],
  ['a missing symbol in the target', 'edge/candidate-diff.o', 'no_such_symbol'],
  ['a missing symbol in the candidate', 'edge/cpp-method.candidate.o', 'add_one'],
  ['a row the engine cannot display', 'edge/candidate-odd-size.o', 'add_one'],
  ['a symbol with zero rows', 'edge/zero-rows.o', 'empty_fn'],
];

test.each(cases)('%s leaves only the config and the target alive', (_name, candidate, symbol) => {
  const { engine, live } = tracked();
  const scorer = createScorer(engine);
  const target = scorer.parseTarget(read(symbol === 'empty_fn' ? 'edge/zero-rows.o' : 'edge/target.o'));
  expect(live.size).toBe(2);
  for (const walk of [scorer.score, scorer.inspect]) {
    try {
      walk(target, read(candidate), symbol);
    } catch {
      // the throw is the point of most cases; what matters is what it left behind
    }
    expect(live.size).toBe(2);
  }
  target.dispose();
  scorer.dispose();
  expect(live.size).toBe(0);
});

test('a candidate that does not parse leaves nothing behind', () => {
  const { engine, live } = tracked();
  const scorer = createScorer(engine);
  const target = scorer.parseTarget(read('edge/target.o'));
  expect(() => scorer.score(target, new TextEncoder().encode('not an object'), 'add_one')).toThrow();
  expect(live.size).toBe(2);
  target.dispose();
  scorer.dispose();
  expect(live.size).toBe(0);
});

test('an invalid diffSetting leaves nothing behind', () => {
  const { engine, live } = tracked();
  expect(() => createScorer(engine, { diffSettings: { bogusKey: 'x' } })).toThrow(/invalid diffSettings/);
  expect(live.size).toBe(0);
});

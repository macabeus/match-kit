// The real engine dies after a few thousand panics (about 2,600 on objdiff-wasm 3.8.1, on Node and on
// Bun). Until then each panic is the object's fault and throws UndiffableError; from then on, every
// call throws EngineFailedError, and nothing is ever a score. This file poisons its engine, so it
// runs in its own worker (vitest isolates files) and nothing else may share it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

import { EngineFailedError, UndiffableError, createScorer, loadEngine } from '../src/index.js';

const read = (name: string) => new Uint8Array(readFileSync(join(import.meta.dirname, 'fixtures', 'edge', name)));

test('a dying engine is reported as one, never as a bad object or a score', { timeout: 60_000 }, async () => {
  const scorer = createScorer(await loadEngine());
  const target = scorer.parseTarget(read('target.o'));
  const odd = read('candidate-odd-size.o');
  const good = read('candidate-diff.o');

  let panics = 0;
  for (; panics < 20_000; panics++) {
    const error = catchError(() => scorer.score(target, odd, 'add_one'));
    if (error instanceof EngineFailedError) {
      break;
    }
    expect(error).toBeInstanceOf(UndiffableError);
    // the good pair keeps scoring correctly right up to the failure
    if (panics % 500 === 0) {
      expect(scorer.score(target, good, 'add_one').score).toBe(1);
    }
  }
  expect(panics).toBeLessThan(20_000);
  expect(() => scorer.score(target, good, 'add_one')).toThrow(EngineFailedError);
  expect(() => scorer.parseTarget(read('target.o'))).toThrow(EngineFailedError);
});

function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected a throw');
}

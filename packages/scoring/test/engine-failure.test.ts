// The real engine dies after about 2,600 panics on objdiff-wasm 3.8.1, on Node and on Bun. Until
// then each panic throws UndiffableError; from then on every call throws EngineFailedError, and
// nothing is ever a score. This file poisons its engine, so nothing else may share its worker
// (vitest isolates files).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { expect, test } from 'vitest';

import { EngineFailedError, UndiffableError, createScorer, loadEngine } from '../src/index.js';

const read = (name: string) => new Uint8Array(readFileSync(join(import.meta.dirname, 'fixtures', 'edge', name)));

test('a dying engine is reported as one, never as a bad object or a score', { timeout: 60_000 }, async () => {
  await killEngine();
  // Nothing left undisposed (both scorers' configs, both targets) may reach the engine's finalizers:
  // their drop would trap on the dead instance, uncaught, and vitest fails the run on it.
  await collectGarbage();
});

async function killEngine(): Promise<void> {
  const engine = await loadEngine();
  // A second scorer on the same engine, holding a target it never uses again.
  createScorer(engine).parseTarget(read('target.o'));
  const scorer = createScorer(engine);
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
    // The good pair keeps scoring correctly right up to the failure.
    if (panics % 500 === 0) {
      expect(scorer.score(target, good, 'add_one').score).toBe(1);
    }
  }
  expect(panics).toBeLessThan(20_000);
  expect(() => scorer.score(target, good, 'add_one')).toThrow(EngineFailedError);
  expect(() => scorer.parseTarget(read('target.o'))).toThrow(EngineFailedError);
}

/** A full collection, then a turn of the event loop for the finalizers it queued. */
async function collectGarbage(): Promise<void> {
  const bun = (globalThis as { Bun?: { gc(force: boolean): void } }).Bun;
  if (bun) {
    bun.gc(true);
  } else {
    setFlagsFromString('--expose-gc');
    (runInNewContext('gc') as () => void)();
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
}

function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected a throw');
}

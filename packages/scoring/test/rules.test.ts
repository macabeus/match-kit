// The counting rules and failure classes, over a scripted engine: cases only a script produces.
import { describe, expect, test } from 'vitest';

import { EngineFailedError, UndiffableError, createScorer } from '../src/index.js';
import { BYTES, fakeEngine } from './fake-engine.js';

const scoreWith = (engine: ReturnType<typeof fakeEngine>) => {
  const scorer = createScorer(engine);
  return scorer.score(scorer.parseTarget(BYTES), BYTES, 'f');
};

describe('counting', () => {
  test('rows run to the longer side; a row past one side is counted from the other', () => {
    const s = scoreWith(
      fakeEngine({ target: { rows: ['none', 'none'] }, candidate: { rows: ['none', 'none', 'insert'] } }),
    );
    expect(s).toMatchObject({ rows: 3, matching: 2, score: 1, breakdown: { insert: 1 } });
  });

  test('a row takes the target side’s kind, else the candidate side’s', () => {
    const s = scoreWith(
      fakeEngine({
        target: { rows: ['replace', 'none', 'none'] },
        candidate: { rows: ['arg-mismatch', 'delete', 'none'] },
      }),
    );
    expect(s.breakdown).toEqual({ insert: 0, delete: 1, replace: 1, opMismatch: 0, argMismatch: 0 });
    expect(s).toMatchObject({ rows: 3, matching: 1, score: 2 });
  });

  test('a row that does not decode is refused when it would count as matching', () => {
    const engine = fakeEngine({ target: { rows: ['none'], undecoded: [0] }, candidate: { rows: ['none'] } });
    expect(() => scoreWith(engine)).toThrow(UndiffableError);
    expect(() => scoreWith(engine)).toThrow(/does not decode as an instruction/);
  });

  test('a row that does not decode is counted when it differs anyway', () => {
    // Data a size-0 target symbol absorbs past its end: the target shows rows the candidate lacks.
    const s = scoreWith(
      fakeEngine({ target: { rows: ['none', 'insert'], undecoded: [1] }, candidate: { rows: ['none'] } }),
    );
    expect(s).toMatchObject({ rows: 2, matching: 1, score: 1, breakdown: { insert: 1 } });
  });
});

describe('failures', () => {
  test('a trap the engine recovers from blames the pair', () => {
    const engine = fakeEngine({
      target: { rows: ['none', 'none'] },
      candidate: { rows: ['none', 'none'] },
      trapAt: { side: 'candidate', row: 1 },
      healthy: () => true,
    });
    expect(() => scoreWith(engine)).toThrow(UndiffableError);
    expect(() => scoreWith(engine)).toThrow(/row 1 of 'f' could not be displayed/);
  });

  test('a trap the engine does not recover from fails the engine, for every scorer, for good', () => {
    const engine = fakeEngine({
      target: { rows: ['none'] },
      candidate: { rows: ['none'] },
      trapAt: { side: 'target', row: 0 },
      healthy: () => false,
    });
    const scorer = createScorer(engine);
    const target = scorer.parseTarget(BYTES);
    expect(() => scorer.score(target, BYTES, 'f')).toThrow(EngineFailedError);
    // Refused before any engine call.
    expect(() => scorer.score(target, BYTES, 'f')).toThrow(EngineFailedError);
    expect(() => scorer.parseTarget(BYTES)).toThrow(EngineFailedError);
    expect(() => createScorer(engine)).toThrow(EngineFailedError);
  });

  test('an engine of another objdiff-wasm version is refused', () => {
    expect(() => createScorer(fakeEngine({ target: { rows: [] }, candidate: { rows: [] }, version: '3.7.1' }))).toThrow(
      /objdiff-wasm 3\.8\.1, and the engine given is 3\.7\.1/,
    );
  });

  test('an invalid diffSetting is refused by name', () => {
    const engine = fakeEngine({ target: { rows: [] }, candidate: { rows: [] }, rejectSettings: true });
    expect(() => createScorer(engine, { diffSettings: { bogusKey: 'x' } })).toThrow(
      /invalid diffSettings: bogusKey = "x"/,
    );
  });

  test('a disposed scorer says so', () => {
    const scorer = createScorer(fakeEngine({ target: { rows: ['none'] }, candidate: { rows: ['none'] } }));
    const target = scorer.parseTarget(BYTES);
    scorer.dispose();
    scorer.dispose();
    expect(() => scorer.score(target, BYTES, 'f')).toThrow(/this scorer was disposed/);
    expect(() => scorer.parseTarget(BYTES)).toThrow(/this scorer was disposed/);
  });
});

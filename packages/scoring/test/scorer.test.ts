import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';

import { SymbolNotFoundError, UndiffableError, createScorer, loadEngine } from '../src/index.js';
import { GOLDEN } from './fixtures.js';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const read = (relative: string) => new Uint8Array(readFileSync(join(FIXTURES, relative)));

const engine = await loadEngine();
const scorer = createScorer(engine);
afterAll(() => scorer.dispose());

describe('golden pairs: every score equals the one asmlift published for it', () => {
  test.each(GOLDEN.map((p) => [p.id, p] as const))('%s', (_id, pair) => {
    const target = scorer.parseTarget(read(`golden/${pair.target}`));
    try {
      expect(scorer.score(target, read(`golden/${pair.candidate}`), pair.symbol)).toEqual(pair.expected);
      expect(pair.expected.score).toBe(pair.from.publishedScore);
    } finally {
      target.dispose();
    }
  });
});

describe('inspect', () => {
  test.each(GOLDEN.map((p) => [p.id, p] as const))('%s counts exactly what score counts', (_id, pair) => {
    const target = scorer.parseTarget(read(`golden/${pair.target}`));
    try {
      const inspection = scorer.inspect(target, read(`golden/${pair.candidate}`), pair.symbol);
      expect(inspection.score).toEqual(pair.expected);
      expect(inspection.rows).toHaveLength(pair.expected.rows);
      expect(inspection.rows.filter((r) => r.kind !== 'none')).toHaveLength(pair.expected.score);
      for (const kind of ['insert', 'delete', 'replace', 'opMismatch', 'argMismatch'] as const) {
        expect(inspection.rows.filter((r) => r.kind === kind)).toHaveLength(pair.expected.breakdown[kind]);
      }
    } finally {
      target.dispose();
    }
  });
});

describe('fail closed: every failure throws, and none is a score', () => {
  const target = scorer.parseTarget(read('edge/target.o'));
  afterAll(() => target.dispose());

  test('a symbol missing from the target', () => {
    const error = catchError(() => scorer.score(target, read('edge/candidate-diff.o'), 'no_such_symbol'));
    expect(error).toBeInstanceOf(SymbolNotFoundError);
    expect(error).toMatchObject({ symbol: 'no_such_symbol', side: 'target' });
    expect((error as Error).message).toMatch(/not found in target object/);
  });

  test('a symbol missing from the candidate', () => {
    const error = catchError(() => scorer.score(target, read('edge/cpp-method.candidate.o'), 'add_one'));
    expect(error).toMatchObject({ name: 'SymbolNotFoundError', side: 'candidate' });
  });

  test('a symbol with zero rows is refused, never counted as a match', () => {
    // asmlift's CLI scorer reported this exact object as `rows: 0, match: true` before this package
    const zero = scorer.parseTarget(read('edge/zero-rows.o'));
    try {
      expect(() => scorer.score(zero, read('edge/zero-rows.o'), 'empty_fn')).toThrow(UndiffableError);
      expect(() => scorer.score(zero, read('edge/zero-rows.o'), 'empty_fn')).toThrow(/no instruction rows/);
    } finally {
      zero.dispose();
    }
  });

  test('a candidate row the engine cannot display', () => {
    // `candidate-odd-size.o` cuts `add_one`'s size to 3 bytes, so its last row is half an instruction.
    // The target's row 0 already differs: a scorer that read the candidate only where the target
    // said `none` would return a score here.
    expect(() => scorer.score(target, read('edge/candidate-odd-size.o'), 'add_one')).toThrow(UndiffableError);
    expect(() => scorer.score(target, read('edge/candidate-odd-size.o'), 'add_one')).toThrow(
      /^row \d+ of 'add_one' could not be displayed: \S/,
    );
  });

  // the engine's own reason is in the message, not only in `cause`: most callers print the message
  test('an unparsable candidate', () => {
    expect(() => scorer.score(target, new TextEncoder().encode('not an object'), 'add_one')).toThrow(
      /^the candidate object could not be parsed: Could not read file magic$/,
    );
  });

  test('an unparsable target', () => {
    expect(() => scorer.parseTarget(new TextEncoder().encode('not an object'))).toThrow(
      /^the target object could not be parsed: Could not read file magic$/,
    );
  });

  test('the scorer keeps working after a failure', () => {
    expect(() => scorer.score(target, read('edge/candidate-odd-size.o'), 'add_one')).toThrow();
    expect(scorer.score(target, read('edge/candidate-diff.o'), 'add_one').score).toBe(1);
  });
});

describe('results', () => {
  test('are frozen, breakdown included', () => {
    const target = scorer.parseTarget(read('edge/target.o'));
    try {
      const s = scorer.score(target, read('edge/candidate-diff.o'), 'add_one');
      expect(Object.isFrozen(s)).toBe(true);
      expect(Object.isFrozen(s.breakdown)).toBe(true);
    } finally {
      target.dispose();
    }
  });

  test('a mangled C++ symbol scores like any other', () => {
    const target = scorer.parseTarget(read('edge/cpp-method.target.o'));
    try {
      expect(scorer.score(target, read('edge/cpp-method.target.o'), 'inc__7CounterFv')).toMatchObject({
        score: 0,
        match: true,
        rows: 7,
      });
      expect(scorer.score(target, read('edge/cpp-method.candidate.o'), 'inc__7CounterFv')).toMatchObject({
        score: 1,
        match: false,
        breakdown: { argMismatch: 1 },
      });
    } finally {
      target.dispose();
    }
  });
});

describe('targets', () => {
  test('belong to the scorer that parsed them', () => {
    const other = createScorer(engine);
    const target = other.parseTarget(read('edge/target.o'));
    try {
      expect(() => scorer.score(target, read('edge/target.o'), 'add_one')).toThrow(/another scorer/);
    } finally {
      target.dispose();
      other.dispose();
    }
  });

  test('cannot be scored against once disposed, and dispose twice is harmless', () => {
    const target = scorer.parseTarget(read('edge/target.o'));
    target.dispose();
    target.dispose();
    expect(() => scorer.score(target, read('edge/target.o'), 'add_one')).toThrow(/disposed/);
  });

  test('survive hundreds of scores (engine handles are released)', () => {
    const target = scorer.parseTarget(read('edge/target.o'));
    try {
      const candidate = read('edge/candidate-diff.o');
      for (let i = 0; i < 1000; i++) {
        expect(scorer.score(target, candidate, 'add_one').score).toBe(1);
      }
    } finally {
      target.dispose();
    }
  });
});

describe('diffSettings', () => {
  const breakloop = GOLDEN.find((p) => p.id === 'agbcc/breakloop.m2c')!;
  const scoreUnder = (diffSettings: Record<string, string>) => {
    const s = createScorer(engine, { diffSettings });
    const target = s.parseTarget(read(`golden/${breakloop.target}`));
    try {
      return s.score(target, read(`golden/${breakloop.candidate}`), breakloop.symbol);
    } finally {
      target.dispose();
      s.dispose();
    }
  };

  test('are applied: a setting that changes the diff changes the score', () => {
    expect(scoreUnder({}).score).toBe(7);
    expect(scoreUnder({ 'arm.unifiedSyntax': 'true' }).score).toBe(9);
  });

  test('that make the engine unable to decode the code are refused, never scored as a match', () => {
    // under ARMv4 no Thumb instruction decodes, and objdiff diffs every undecoded row as `none`:
    // counted, two different objects would score 0 and match
    expect(() => scoreUnder({ 'arm.archVersion': 'v4' })).toThrow(/does not decode as an instruction/);
  });
});

describe('configKey', () => {
  test('is empty for the default config', () => {
    expect(scorer.configKey).toBe('');
  });

  test('is the same whatever order the settings come in', () => {
    const a = createScorer(engine, { diffSettings: { functionRelocDiffs: 'none', spaceBetweenArgs: 'false' } });
    const b = createScorer(engine, { diffSettings: { spaceBetweenArgs: 'false', functionRelocDiffs: 'none' } });
    try {
      expect(a.configKey).not.toBe('');
      expect(a.configKey).toBe(b.configKey);
    } finally {
      a.dispose();
      b.dispose();
    }
  });
});

function catchError(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected a throw');
}

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';

import { SymbolNotFoundError, UndiffableError, createScorer } from '../src/index.js';
import { REFERENCE_PAIRS } from './fixtures.js';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const read = (relative: string) => new Uint8Array(readFileSync(join(FIXTURES, relative)));

const scorer = await createScorer();
afterAll(() => scorer.dispose());

describe('reference pairs: score and inspect give the score asmlift published', () => {
  test.each(REFERENCE_PAIRS.map((p) => [p.id, p] as const))('%s', (_id, pair) => {
    expect(pair.expected.score).toBe(pair.from.publishedScore);
    const target = scorer.parseTarget(read(`reference/${pair.target}`));
    try {
      const candidate = read(`reference/${pair.candidate}`);
      expect(scorer.score(target, candidate, pair.symbol)).toEqual(pair.expected);
      const inspection = scorer.inspect(target, candidate, pair.symbol);
      expect(inspection.score).toEqual(pair.expected);
      expect(inspection.rows).toHaveLength(pair.expected.rows);
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
    const zero = scorer.parseTarget(read('edge/zero-rows.o'));
    try {
      expect(() => scorer.score(zero, read('edge/zero-rows.o'), 'empty_fn')).toThrow(UndiffableError);
      expect(() => scorer.score(zero, read('edge/zero-rows.o'), 'empty_fn')).toThrow(/no instruction rows/);
    } finally {
      zero.dispose();
    }
  });

  test('a candidate row the engine cannot display', () => {
    // `candidate-odd-size.o` cuts `add_one` to 3 bytes, so its last row is half an instruction. Its
    // row 0 already differs from the target, so this also checks every candidate row is displayed.
    expect(() => scorer.score(target, read('edge/candidate-odd-size.o'), 'add_one')).toThrow(UndiffableError);
    expect(() => scorer.score(target, read('edge/candidate-odd-size.o'), 'add_one')).toThrow(
      /^row \d+ of 'add_one' could not be displayed: \S/,
    );
  });

  // The engine's reason is in the message, not only in `cause`: most callers print only the message.
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

  test('an undecoded row that differs counts as a difference, not a refusal', () => {
    // The target's unsized `F` absorbs a halfword ARMv4T cannot decode, and the candidate has no row there.
    const absorbing = scorer.parseTarget(read('edge/absorbed-data.target.o'));
    try {
      expect(scorer.score(absorbing, read('edge/absorbed-data.candidate.o'), 'F')).toMatchObject({
        rows: 4,
        matching: 2,
        score: 2,
        breakdown: { delete: 2 },
      });
    } finally {
      absorbing.dispose();
    }
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
  test('belong to the scorer that parsed them', async () => {
    const other = await createScorer();
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
});

describe('scorers', () => {
  test('refuse every call once disposed, and dispose twice is harmless', async () => {
    const s = await createScorer();
    const target = s.parseTarget(read('edge/target.o'));
    s.dispose();
    s.dispose();
    expect(() => s.score(target, read('edge/target.o'), 'add_one')).toThrow(/this scorer was disposed/);
    expect(() => s.parseTarget(read('edge/target.o'))).toThrow(/this scorer was disposed/);
    target.dispose();
  });
});

describe('diffSettings', () => {
  const breakloop = REFERENCE_PAIRS.find((p) => p.id === 'agbcc/breakloop.m2c')!;
  const scoreUnder = async (diffSettings: Record<string, string>) => {
    const s = await createScorer({ diffSettings });
    const target = s.parseTarget(read(`reference/${breakloop.target}`));
    try {
      return s.score(target, read(`reference/${breakloop.candidate}`), breakloop.symbol);
    } finally {
      target.dispose();
      s.dispose();
    }
  };

  test('are applied: a setting that changes the diff changes the score', async () => {
    expect((await scoreUnder({})).score).toBe(7);
    expect((await scoreUnder({ 'arm.unifiedSyntax': 'true' })).score).toBe(9);
  });

  test('an invalid one is refused by name', async () => {
    await expect(createScorer({ diffSettings: { bogusKey: 'x' } })).rejects.toThrow(
      /invalid diffSettings: bogusKey = "x"/,
    );
  });

  test('that make the engine unable to decode the code are refused, never scored as a match', async () => {
    // Under ARMv4 no Thumb instruction decodes, and objdiff diffs every undecoded row as `none`:
    // counted, two different objects would score 0 and match.
    await expect(scoreUnder({ 'arm.archVersion': 'v4' })).rejects.toThrow(/does not decode as an instruction/);
  });
});

describe('configKey', () => {
  test('is empty for the default config', () => {
    expect(scorer.configKey).toBe('');
  });

  test('is the same whatever order the settings come in', async () => {
    const a = await createScorer({ diffSettings: { functionRelocDiffs: 'none', spaceBetweenArgs: 'false' } });
    const b = await createScorer({ diffSettings: { spaceBetweenArgs: 'false', functionRelocDiffs: 'none' } });
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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SymbolNotFoundError, type Target, UndiffableError, createScorer } from '../src/index.js';
import { REFERENCE_PAIRS } from './fixtures.js';

const FIXTURES = join(import.meta.dirname, 'fixtures');
const read = (relative: string) => new Uint8Array(readFileSync(join(FIXTURES, relative)));

const scorer = await createScorer();
afterAll(() => scorer.dispose());

describe('.score', () => {
  // Most failures are scored against one target.
  let target: Target;
  beforeAll(() => {
    target = scorer.parseTarget(read('edge/target.o'));
  });
  afterAll(() => target.dispose());

  it.each(REFERENCE_PAIRS.map((p) => [p.id, p] as const))(
    'scores %s as asmlift published, and .inspect agrees',
    (_id, pair) => {
      expect(pair.expected.score).toBe(pair.from.publishedScore);
      using target = scorer.parseTarget(read(`reference/${pair.target}`));
      const candidate = read(`reference/${pair.candidate}`);
      expect(scorer.score(target, candidate, pair.symbol)).toEqual(pair.expected);
      const inspection = scorer.inspect(target, candidate, pair.symbol);
      expect(inspection.score).toEqual(pair.expected);
      expect(inspection.rows).toHaveLength(pair.expected.rows);
      for (const kind of ['insert', 'delete', 'replace', 'opMismatch', 'argMismatch'] as const) {
        expect(inspection.rows.filter((r) => r.kind === kind)).toHaveLength(pair.expected.breakdown[kind]);
      }
    },
  );

  it('throws SymbolNotFoundError when the symbol is missing from the target', () => {
    const error = catchError(() => scorer.score(target, read('edge/candidate-diff.o'), 'no_such_symbol'));
    expect(error).toBeInstanceOf(SymbolNotFoundError);
    expect(error).toMatchObject({ symbol: 'no_such_symbol', side: 'target' });
    expect((error as Error).message).toMatch(/not found in target object/);
  });

  it('throws SymbolNotFoundError when the symbol is missing from the candidate', () => {
    const error = catchError(() => scorer.score(target, read('edge/cpp-method.candidate.o'), 'add_one'));
    expect(error).toMatchObject({ name: 'SymbolNotFoundError', side: 'candidate' });
  });

  it('throws UndiffableError for a symbol with zero rows', () => {
    using zero = scorer.parseTarget(read('edge/zero-rows.o'));
    expect(() => scorer.score(zero, read('edge/zero-rows.o'), 'empty_fn')).toThrow(UndiffableError);
    expect(() => scorer.score(zero, read('edge/zero-rows.o'), 'empty_fn')).toThrow(/no instruction rows/);
  });

  it('throws UndiffableError when a candidate row cannot be displayed', () => {
    // `candidate-odd-size.o` cuts `add_one` to 3 bytes, so its last row is half an instruction. Its
    // row 0 already differs from the target, so this also checks every candidate row is displayed.
    expect(() => scorer.score(target, read('edge/candidate-odd-size.o'), 'add_one')).toThrow(UndiffableError);
    expect(() => scorer.score(target, read('edge/candidate-odd-size.o'), 'add_one')).toThrow(
      /^row \d+ of 'add_one' could not be displayed: \S/,
    );
  });

  it('throws with the engine’s reason when the candidate does not parse', () => {
    expect(() => scorer.score(target, new TextEncoder().encode('not an object'), 'add_one')).toThrow(
      /^the candidate object could not be parsed: Could not read file magic$/,
    );
  });

  it('counts an undecoded row that differs as a difference', () => {
    // The target's unsized `F` absorbs a halfword ARMv4T cannot decode, and the candidate has no row there.
    using absorbing = scorer.parseTarget(read('edge/absorbed-data.target.o'));
    expect(scorer.score(absorbing, read('edge/absorbed-data.candidate.o'), 'F')).toMatchObject({
      rows: 4,
      matching: 2,
      score: 2,
      breakdown: { delete: 2 },
    });
  });

  it('keeps scoring after a failure', () => {
    expect(() => scorer.score(target, read('edge/candidate-odd-size.o'), 'add_one')).toThrow();
    expect(scorer.score(target, read('edge/candidate-diff.o'), 'add_one').score).toBe(1);
  });

  it('returns a frozen score, breakdown included', () => {
    using target = scorer.parseTarget(read('edge/target.o'));
    const s = scorer.score(target, read('edge/candidate-diff.o'), 'add_one');
    expect(Object.isFrozen(s)).toBe(true);
    expect(Object.isFrozen(s.breakdown)).toBe(true);
  });

  it('scores a mangled C++ symbol like any other', () => {
    using target = scorer.parseTarget(read('edge/cpp-method.target.o'));
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
  });

  it('throws for a target another scorer parsed', async () => {
    using other = await createScorer();
    using target = other.parseTarget(read('edge/target.o'));
    expect(() => scorer.score(target, read('edge/target.o'), 'add_one')).toThrow(/another scorer/);
  });
});

describe('.parseTarget', () => {
  it('throws with the engine’s reason when the target does not parse', () => {
    expect(() => scorer.parseTarget(new TextEncoder().encode('not an object'))).toThrow(
      /^the target object could not be parsed: Could not read file magic$/,
    );
  });
});

describe('Target', () => {
  it('refuses to be scored once disposed, and ignores a second dispose', () => {
    const target = scorer.parseTarget(read('edge/target.o'));
    target.dispose();
    target.dispose();
    expect(() => scorer.score(target, read('edge/target.o'), 'add_one')).toThrow(/disposed/);
  });
});

describe('Scorer', () => {
  it('refuses every call once disposed, and ignores a second dispose', async () => {
    const s = await createScorer();
    const target = s.parseTarget(read('edge/target.o'));
    s.dispose();
    s.dispose();
    expect(() => s.score(target, read('edge/target.o'), 'add_one')).toThrow(/this scorer was disposed/);
    expect(() => s.parseTarget(read('edge/target.o'))).toThrow(/this scorer was disposed/);
    target.dispose();
  });
});

describe('createScorer', () => {
  const breakloop = REFERENCE_PAIRS.find((p) => p.id === 'agbcc/breakloop.m2c')!;
  const scoreUnder = async (diffSettings: Record<string, string>) => {
    using s = await createScorer({ diffSettings });
    using target = s.parseTarget(read(`reference/${breakloop.target}`));
    return s.score(target, read(`reference/${breakloop.candidate}`), breakloop.symbol);
  };

  it('applies diffSettings: a setting that changes the diff changes the score', async () => {
    expect((await scoreUnder({})).score).toBe(7);
    expect((await scoreUnder({ 'arm.unifiedSyntax': 'true' })).score).toBe(9);
  });

  it('rejects an invalid diffSetting by name', async () => {
    await expect(createScorer({ diffSettings: { bogusKey: 'x' } })).rejects.toThrow(
      /invalid diffSettings: bogusKey = "x"/,
    );
  });

  it('refuses to score code the engine cannot decode under the given diffSettings', async () => {
    // Under ARMv4 no Thumb instruction decodes, and objdiff diffs every undecoded row as `none`:
    // counted, two different objects would score 0 and match.
    await expect(scoreUnder({ 'arm.archVersion': 'v4' })).rejects.toThrow(/does not decode as an instruction/);
  });
});

describe('.configKey', () => {
  it('is empty for the default config', () => {
    expect(scorer.configKey).toBe('');
  });

  it('does not depend on the order of the settings', async () => {
    using a = await createScorer({ diffSettings: { functionRelocDiffs: 'none', spaceBetweenArgs: 'false' } });
    using b = await createScorer({ diffSettings: { spaceBetweenArgs: 'false', functionRelocDiffs: 'none' } });
    expect(a.configKey).not.toBe('');
    expect(a.configKey).toBe(b.configKey);
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

// `scoreFiles` and its two memos. Moved from asmlift's `packages/cli/test/offline/objdiff.test.ts`,
// where they pinned the same behaviour of `scoreObjects`.
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';

import { releaseTarget, scoreFiles } from '../src/node.js';

const EDGE = join(import.meta.dirname, 'fixtures', 'edge');
const TARGET = join(EDGE, 'target.o');
const DIFF = join(EDGE, 'candidate-diff.o');
const ODD_SIZE = join(EDGE, 'candidate-odd-size.o');

const SCRATCH = mkdtempSync(join(tmpdir(), 'matchkit-scoring-'));
afterAll(() => {
  releaseTarget();
  rmSync(SCRATCH, { recursive: true, force: true });
});

test('identical object scores 0 and matches', () => {
  const s = scoreFiles(TARGET, TARGET, 'add_one');
  expect(s).toMatchObject({ match: true, score: 0 });
  expect(s.rows).toBeGreaterThan(0);
  expect(s.matching).toBe(s.rows);
});

test('differing candidate scores > 0, and the breakdown names the bucket', () => {
  // `add r0, #1` against `add r0, #2`: same mnemonic, same register, differing immediate
  const s = scoreFiles(TARGET, DIFF, 'add_one');
  expect(s.match).toBe(false);
  expect(s.breakdown).toEqual({ insert: 0, delete: 0, replace: 0, opMismatch: 0, argMismatch: s.score });
});

test('missing symbol, unparsable object and missing file all THROW', () => {
  expect(() => scoreFiles(TARGET, DIFF, 'no_such_symbol')).toThrow(/not found/);
  expect(() => scoreFiles(TARGET, import.meta.filename, 'add_one')).toThrow();
  expect(() => scoreFiles(TARGET, join(EDGE, 'does-not-exist.o'), 'add_one')).toThrow();
});

// THE TARGET MEMO: the parse is reused across calls, keyed on the file's whole content.

test('a target rewritten in place is re-parsed, never scored against stale bytes', () => {
  const moving = join(SCRATCH, 'target.o');
  copyFileSync(TARGET, moving);
  expect(scoreFiles(moving, DIFF, 'add_one').match).toBe(false);
  // same path, different bytes: the candidate is now its own target
  copyFileSync(DIFF, moving);
  expect(scoreFiles(moving, DIFF, 'add_one')).toMatchObject({ match: true, score: 0 });
});

test('the same bytes under two paths score the same', () => {
  const copy = join(SCRATCH, 'copy.o');
  copyFileSync(TARGET, copy);
  expect(scoreFiles(copy, DIFF, 'add_one')).toEqual(scoreFiles(TARGET, DIFF, 'add_one'));
});

test('an unparsable target THROWS and leaves the previous one intact', () => {
  const broken = join(SCRATCH, 'broken.o');
  writeFileSync(broken, 'not an object file');
  const before = scoreFiles(TARGET, DIFF, 'add_one');
  expect(() => scoreFiles(broken, DIFF, 'add_one')).toThrow();
  expect(scoreFiles(TARGET, DIFF, 'add_one')).toEqual(before);
});

test('scoring the same target repeatedly is stable', () => {
  const first = scoreFiles(TARGET, DIFF, 'add_one');
  for (let i = 0; i < 5; i++) {
    expect(scoreFiles(TARGET, TARGET, 'add_one').match).toBe(true);
    expect(scoreFiles(TARGET, DIFF, 'add_one')).toEqual(first);
  }
});

test('a candidate row the engine cannot display THROWS', () => {
  expect(() => scoreFiles(TARGET, ODD_SIZE, 'add_one')).toThrow();
});

test('releaseTarget drops the memo, is idempotent, and the next score re-parses', () => {
  const before = scoreFiles(TARGET, DIFF, 'add_one');
  releaseTarget();
  releaseTarget();
  expect(scoreFiles(TARGET, DIFF, 'add_one')).toEqual(before);
});

// THE SCORE MEMO: a score already taken against the retained target is handed back.

test('a candidate rewritten in place is re-scored, never handed the previous one’s score', () => {
  // every compile worker rewrites ONE scratch slot's object, so a path-keyed memo would answer
  // for the previous candidate
  const slot = join(SCRATCH, 'cand.o');
  copyFileSync(DIFF, slot);
  expect(scoreFiles(TARGET, slot, 'add_one').match).toBe(false);
  copyFileSync(TARGET, slot);
  expect(scoreFiles(TARGET, slot, 'add_one').match).toBe(true);
});

test('the symbol is part of the key', () => {
  expect(scoreFiles(TARGET, DIFF, 'add_one').score).toBeGreaterThan(0);
  expect(() => scoreFiles(TARGET, DIFF, 'no_such_symbol')).toThrow(/not found/);
});

test('the memo dies with the target', () => {
  const against = (t: string) => scoreFiles(t, DIFF, 'add_one');
  expect(against(TARGET).match).toBe(false);
  expect(against(DIFF).match).toBe(true);
  expect(against(TARGET).match).toBe(false);
});

test('a candidate that THROWS is not remembered — it throws again', () => {
  expect(() => scoreFiles(TARGET, ODD_SIZE, 'add_one')).toThrow();
  expect(() => scoreFiles(TARGET, ODD_SIZE, 'add_one')).toThrow();
  expect(scoreFiles(TARGET, DIFF, 'add_one').match).toBe(false);
});

test('a returned score is FROZEN — one object serves every candidate with these bytes', () => {
  const s = scoreFiles(TARGET, DIFF, 'add_one');
  expect(() => {
    (s as { score: number }).score = 99;
  }).toThrow(TypeError);
  expect(scoreFiles(TARGET, DIFF, 'add_one').score).toBe(s.score);
});

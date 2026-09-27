// `scoreFiles`: reading the two files, and its two memos.
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';

import { releaseTarget, scoreFiles } from '../src/files.js';

const EDGE = join(import.meta.dirname, 'fixtures', 'edge');
const TARGET = join(EDGE, 'target.o');
const DIFF = join(EDGE, 'candidate-diff.o');
const ODD_SIZE = join(EDGE, 'candidate-odd-size.o');

const SCRATCH = mkdtempSync(join(tmpdir(), 'matchkit-scoring-'));
afterAll(() => {
  releaseTarget();
  rmSync(SCRATCH, { recursive: true, force: true });
});

test('scores the objects at two paths', () => {
  expect(scoreFiles(TARGET, DIFF, 'add_one')).toMatchObject({ score: 1, match: false });
  expect(scoreFiles(TARGET, TARGET, 'add_one')).toMatchObject({ score: 0, match: true });
});

test('a missing file throws', () => {
  expect(() => scoreFiles(TARGET, join(EDGE, 'does-not-exist.o'), 'add_one')).toThrow();
});

// The target memo: the parse is reused across calls, keyed on the file's whole content.

test('a target rewritten in place is re-parsed, never scored against stale bytes', () => {
  const moving = join(SCRATCH, 'target.o');
  copyFileSync(TARGET, moving);
  expect(scoreFiles(moving, DIFF, 'add_one').match).toBe(false);
  // Same path, different bytes: the candidate is now its own target.
  copyFileSync(DIFF, moving);
  expect(scoreFiles(moving, DIFF, 'add_one')).toMatchObject({ match: true, score: 0 });
});

test('the same bytes under two paths score the same', () => {
  const copy = join(SCRATCH, 'copy.o');
  copyFileSync(TARGET, copy);
  expect(scoreFiles(copy, DIFF, 'add_one')).toEqual(scoreFiles(TARGET, DIFF, 'add_one'));
});

test('an unparsable target throws, and the previous target still scores', () => {
  const broken = join(SCRATCH, 'broken.o');
  writeFileSync(broken, 'not an object file');
  const before = scoreFiles(TARGET, DIFF, 'add_one');
  expect(() => scoreFiles(broken, DIFF, 'add_one')).toThrow();
  expect(scoreFiles(TARGET, DIFF, 'add_one')).toEqual(before);
});

test('releaseTarget is idempotent, and the next score parses the target again', () => {
  const before = scoreFiles(TARGET, DIFF, 'add_one');
  releaseTarget();
  releaseTarget();
  expect(scoreFiles(TARGET, DIFF, 'add_one')).toEqual(before);
});

// The score memo: a score already taken against the memoized target is handed back.

test('a candidate rewritten in place is re-scored, never handed the previous one’s score', () => {
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

test('a candidate that throws is not remembered: it throws again', () => {
  expect(() => scoreFiles(TARGET, ODD_SIZE, 'add_one')).toThrow();
  expect(() => scoreFiles(TARGET, ODD_SIZE, 'add_one')).toThrow();
});

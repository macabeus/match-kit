// `scoreFiles`: reading the two files, and its two memos.
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

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

describe('scoreFiles', () => {
  it('scores the objects at two paths', () => {
    expect(scoreFiles(TARGET, DIFF, 'add_one')).toMatchObject({ score: 1, match: false });
    expect(scoreFiles(TARGET, TARGET, 'add_one')).toMatchObject({ score: 0, match: true });
  });

  it('throws when a file does not exist', () => {
    expect(() => scoreFiles(TARGET, join(EDGE, 'does-not-exist.o'), 'add_one')).toThrow();
  });

  // The parse is reused across calls, keyed on the file's whole content.
  describe('the target memo', () => {
    it('parses a target again when it is rewritten in place', () => {
      const moving = join(SCRATCH, 'target.o');
      copyFileSync(TARGET, moving);
      expect(scoreFiles(moving, DIFF, 'add_one').match).toBe(false);
      // Same path, different bytes: the candidate is now its own target.
      copyFileSync(DIFF, moving);
      expect(scoreFiles(moving, DIFF, 'add_one')).toMatchObject({ match: true, score: 0 });
    });

    it('scores the same bytes under two paths the same', () => {
      const copy = join(SCRATCH, 'copy.o');
      copyFileSync(TARGET, copy);
      expect(scoreFiles(copy, DIFF, 'add_one')).toEqual(scoreFiles(TARGET, DIFF, 'add_one'));
    });

    it('keeps the previous target when a new one does not parse', () => {
      const broken = join(SCRATCH, 'broken.o');
      writeFileSync(broken, 'not an object file');
      const before = scoreFiles(TARGET, DIFF, 'add_one');
      expect(() => scoreFiles(broken, DIFF, 'add_one')).toThrow();
      expect(scoreFiles(TARGET, DIFF, 'add_one')).toEqual(before);
    });
  });

  // A score already taken against the memoized target is handed back.
  describe('the score memo', () => {
    it('scores a candidate again when it is rewritten in place', () => {
      const slot = join(SCRATCH, 'cand.o');
      copyFileSync(DIFF, slot);
      expect(scoreFiles(TARGET, slot, 'add_one').match).toBe(false);
      copyFileSync(TARGET, slot);
      expect(scoreFiles(TARGET, slot, 'add_one').match).toBe(true);
    });

    it('does not answer one symbol with another symbol’s score', () => {
      expect(scoreFiles(TARGET, DIFF, 'add_one').score).toBeGreaterThan(0);
      expect(() => scoreFiles(TARGET, DIFF, 'no_such_symbol')).toThrow(/not found/);
    });

    it('does not reuse a score taken against another target', () => {
      const against = (t: string) => scoreFiles(t, DIFF, 'add_one');
      expect(against(TARGET).match).toBe(false);
      expect(against(DIFF).match).toBe(true);
      expect(against(TARGET).match).toBe(false);
    });

    it('does not remember a candidate that throws', () => {
      expect(() => scoreFiles(TARGET, ODD_SIZE, 'add_one')).toThrow();
      expect(() => scoreFiles(TARGET, ODD_SIZE, 'add_one')).toThrow();
    });
  });
});

describe('releaseTarget', () => {
  it('makes the next score parse the target again, and does nothing when called twice', () => {
    const before = scoreFiles(TARGET, DIFF, 'add_one');
    releaseTarget();
    releaseTarget();
    expect(scoreFiles(TARGET, DIFF, 'add_one')).toEqual(before);
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';

import { assembly, differences, sideBySide } from '../src/display.js';
import { type Inspection, createScorer, loadEngine } from '../src/index.js';

const EDGE = join(import.meta.dirname, 'fixtures', 'edge');
const read = (name: string) => new Uint8Array(readFileSync(join(EDGE, name)));

const scorer = createScorer(await loadEngine());
const target = scorer.parseTarget(read('target.o'));
const inspection: Inspection = scorer.inspect(target, read('candidate-diff.o'), 'add_one');

test('assembly prints one side, a line per row', () => {
  expect(assembly(inspection, 'target').split('\n')).toHaveLength(inspection.score.rows);
  expect(assembly(inspection, 'target')).toMatch(/0x1/);
  expect(assembly(inspection, 'candidate')).toMatch(/0x2/);
});

test('differences lists exactly the differing rows, with both sides', () => {
  const diffs = differences(inspection);
  expect(diffs).toHaveLength(inspection.score.score);
  expect(diffs[0]).toMatchObject({ row: 0, kind: 'argMismatch' });
  expect(diffs[0]!.target).toMatch(/0x1/);
  expect(diffs[0]!.candidate).toMatch(/0x2/);
});

test('sideBySide marks the differing rows only', () => {
  const lines = sideBySide(inspection).split('\n');
  expect(lines[0]).toMatch(/^target\s+candidate$/);
  const body = lines.slice(2);
  expect(body).toHaveLength(inspection.score.rows);
  expect(body.filter((l) => l.includes(' | '))).toHaveLength(inspection.score.score);
});

test('a side past its own rows prints as empty, not as a crash', () => {
  const lopsided: Inspection = {
    score: inspection.score,
    rows: [
      { row: 0, kind: 'insert', target: null, candidate: 'mov r0, #0x1' },
      { row: 1, kind: 'none', target: 'bx lr', candidate: 'bx lr' },
    ],
  };
  expect(assembly(lopsided, 'target')).toBe('bx lr');
  expect(differences(lopsided)).toEqual([{ row: 0, kind: 'insert', target: '', candidate: 'mov r0, #0x1' }]);
  expect(sideBySide(lopsided)).toContain('|  mov r0, #0x1');
});

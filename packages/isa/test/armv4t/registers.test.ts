// registerEffect: the registers a Thumb instruction writes and the ones its value is followed back to, read
// from the row's RegisterSpec.
import assert from 'node:assert/strict';
import { test } from 'vitest';

import { IsaInvariantError, ROWS, decode, effectOf, registerEffect, thumbWordAt } from '../../src/armv4t.js';
import { assembleSnippet } from './snippet.js';

const F = 0x0800_0200;

function effects(text: string): Array<{ writes: number; from: readonly number[] }> {
  const bytes = assembleSnippet('thumb', text, F);
  const read16 = (addr: number): number | undefined =>
    addr + 2 <= F + bytes.length ? (bytes[addr - F] ?? 0) | ((bytes[addr - F + 1] ?? 0) << 8) : undefined;
  const out: Array<{ writes: number; from: readonly number[] }> = [];
  for (let a = F; a < F + bytes.length;) {
    const insn = decode('thumb', thumbWordAt(read16, a), a);
    out.push({ ...registerEffect(insn) });
    a += insn.size;
  }
  return out;
}

test('moves, adds and word loads are followed to their source registers', () => {
  assert.deepEqual(
    effects(
      'movs r1, r2; adds r0, r1, r2; adds r3, r4, #1; adds r5, #8; add r8, r1; mov r9, r2; ldr r0, [r1, r2]; ldr r0, [r3, #4]',
    ),
    [
      { writes: 1 << 1, from: [2] },
      { writes: 1 << 0, from: [1, 2] },
      { writes: 1 << 3, from: [4] },
      { writes: 1 << 5, from: [5] },
      { writes: 1 << 8, from: [8, 1] },
      { writes: 1 << 9, from: [2] },
      { writes: 1 << 0, from: [1, 2] },
      { writes: 1 << 0, from: [3] },
    ],
  );
});

test('constants, other arithmetic and byte loads write without being followed; stores, compares and branches write nothing', () => {
  assert.deepEqual(effects('movs r1, #3; lsls r0, r0, #2; subs r2, r2, r1; ldrb r0, [r1, r2]; muls r3, r4'), [
    { writes: 1 << 1, from: [] },
    { writes: 1 << 0, from: [] },
    { writes: 1 << 2, from: [] },
    { writes: 1 << 0, from: [] },
    { writes: 1 << 3, from: [] },
  ]);
  assert.deepEqual(effects('str r0, [r1, #4]; cmp r0, #3; tst r0, r1; push {r4, lr}'), [
    { writes: 0, from: [] },
    { writes: 0, from: [] },
    { writes: 0, from: [] },
    { writes: 0, from: [] },
  ]);
});

test('pop, ldmia, stmia, a call and a BIOS call write their registers', () => {
  assert.deepEqual(effects('pop {r4, r5}; pop {r4, pc}; ldmia r1!, {r2, r3}; stmia r0!, {r1}; bl _08000400; swi #6'), [
    { writes: 0b11_0000, from: [] },
    { writes: (1 << 4) | (1 << 15), from: [] },
    { writes: 0b1110, from: [] },
    { writes: 1, from: [] },
    { writes: 0b0101_0000_0000_1111, from: [] },
    { writes: 0b1111, from: [] },
  ]);
});

test('every Thumb row that writes a general register as data says so in the table: no row writes rd without a RegisterSpec', () => {
  const declared = ROWS.thumb.filter((r) => r.spec.registers !== undefined).map((r) => r.spec.id);
  const writesRd = ROWS.thumb.filter(
    (r) =>
      r.spec.fields.some((f) => f.name === 'rd') &&
      !/^thumb\.(str|strb|strh)_/.test(r.spec.id) &&
      r.spec.id !== 'thumb.str_sp',
  );
  for (const r of writesRd) {
    assert.ok(declared.includes(r.spec.id), `${r.spec.id} has an rd field but no RegisterSpec`);
  }
  assert.equal(declared.length, 44, 'the 38 rows that write rd, pop, pop {.., pc}, ldmia, stmia, bl and swi');
});

test("every name a row's RegisterSpec uses (writes, list, from) is one of that row's operands", () => {
  let checked = 0;
  for (const row of [...ROWS.thumb, ...ROWS.arm]) {
    const spec = row.spec.registers;
    if (spec === undefined) {
      continue;
    }
    const fields = Object.fromEntries(row.spec.fields.map((f) => [f.name, 0]));
    const ops = Object.keys(row.toOps(fields, F));
    for (const name of [
      ...(spec.writes ?? []),
      ...(spec.list === undefined ? [] : [spec.list]),
      ...(spec.from ?? []),
    ]) {
      assert.ok(ops.includes(name), `${row.spec.id}: '${name}' is not one of its operands (${ops.join(', ')})`);
      checked += 1;
    }
  }
  assert.ok(checked > 44, `${checked} names checked`);
});

test('an operand name the row lacks throws IsaInvariantError instead of reading as r0', () => {
  assert.deepEqual(effectOf({ writes: ['rd'], from: ['rs'] }, { rd: 1, rs: 2 }, 'thumb.test'), {
    writes: 2,
    from: [2],
  });
  assert.throws(() => effectOf({ writes: ['Rd'] }, { rd: 1 }, 'thumb.test'), IsaInvariantError);
  assert.throws(() => effectOf({ list: 'regs' }, { rlist: 3 }, 'thumb.test'), /names 'regs'/);
  assert.throws(() => effectOf({ from: ['rn'] }, { rd: 0 }, 'thumb.test'), IsaInvariantError);
});

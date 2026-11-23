// registerEffect: the registers an instruction writes and the ones its value is followed back to.
import { assert, test } from 'vitest';

import { IsaInvariantError, ROWS, decode, effectOf, registerEffect, thumbWordAt } from '../../src/armv4t.js';
import { prngSequence } from './prng.js';
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

test('pop, ldmia and stmia write their registers', () => {
  assert.deepEqual(effects('pop {r4, r5}; pop {r4, pc}; ldmia r1!, {r2, r3}; stmia r0!, {r1}'), [
    { writes: 0b11_0000, from: [] },
    { writes: (1 << 4) | (1 << 15), from: [] },
    { writes: 0b1110, from: [] },
    { writes: 1, from: [] },
  ]);
});

test('every Thumb row with an rd field that is not a store says what it writes', () => {
  const writesRd = ROWS.thumb.filter(
    (r) =>
      r.spec.fields.some((f) => f.name === 'rd') &&
      !/^thumb\.(str|strb|strh)_/.test(r.spec.id) &&
      r.spec.id !== 'thumb.str_sp',
  );
  for (const r of writesRd) {
    assert.ok(r.registers !== undefined, `${r.spec.id} has an rd field but says nothing of what it writes`);
  }
});

test('no row names an operand it lacks: every Thumb halfword, bl pair and a seeded ARM sample has an effect', () => {
  for (let hw = 0; hw < 0x10000; hw++) {
    registerEffect(decode('thumb', hw, F));
  }
  for (const word of prngSequence(0x5eed, 1 << 16)) {
    registerEffect(decode('arm', word, F));
    registerEffect(decode('thumb', (word | 0xf800_f000) >>> 0, F));
  }
});

test('a call writes lr and nothing else: what a callee clobbers is a calling convention, not the instruction', () => {
  assert.deepEqual(effects('bl _08000400; swi #6'), [
    { writes: 1 << 14, from: [] },
    { writes: 0, from: [] },
  ]);
  assert.deepEqual(registerEffect(decode('arm', 0xeb00_0000, F)), { writes: 1 << 14, from: [] });
  // Half a bl is an instruction too: each half writes lr.
  assert.deepEqual(registerEffect(decode('thumb', 0xf000, F)), { writes: 1 << 14, from: [] });
  assert.deepEqual(registerEffect(decode('thumb', 0xf800, F)), { writes: 1 << 14, from: [] });
});

function armEffects(text: string): Array<{ writes: number; from: readonly number[] }> {
  const bytes = assembleSnippet('arm', text, F);
  const out: Array<{ writes: number; from: readonly number[] }> = [];
  for (let at = 0; at < bytes.length; at += 4) {
    const word = new DataView(bytes.buffer, bytes.byteOffset + at, 4).getUint32(0, true);
    out.push({ ...registerEffect(decode('arm', word, F + at)) });
  }
  return out;
}

test('ARM data processing writes rd, followed to its sources for a move and a sum of registers', () => {
  assert.deepEqual(
    armEffects(
      'mov r0, r1; mov r0, r1, lsl #2; mov r0, #1; add r2, r3, #4; add r2, r3, r4; add r2, r3, r4, lsl #1; sub r5, r6, r7; cmp r0, r1; adr r8, _08000300',
    ),
    [
      { writes: 1 << 0, from: [1] },
      { writes: 1 << 0, from: [] },
      { writes: 1 << 0, from: [] },
      { writes: 1 << 2, from: [3] },
      { writes: 1 << 2, from: [3, 4] },
      { writes: 1 << 2, from: [] },
      { writes: 1 << 5, from: [] },
      { writes: 0, from: [] },
      { writes: 1 << 8, from: [] },
    ],
  );
});

test('ARM transfers write rd for a load and the base when it is written back', () => {
  assert.deepEqual(
    armEffects(
      'ldr r0, [r1, #4]; ldr r0, [r1, r2]; ldrb r0, [r1]; ldr r0, [r1], #4; ldr r0, [r1, #4]!; str r0, [r1, #4]; str r0, [r1, #-4]!; ldrh r3, [r4]; strh r3, [r4], #2',
    ),
    [
      { writes: 1 << 0, from: [1] },
      { writes: 1 << 0, from: [1, 2] },
      { writes: 1 << 0, from: [] },
      { writes: 0b11, from: [1] },
      { writes: 0b11, from: [1] },
      { writes: 0, from: [] },
      { writes: 1 << 1, from: [] },
      { writes: 1 << 3, from: [] },
      { writes: 1 << 4, from: [] },
    ],
  );
});

test('ARM block transfers, multiplies, swp and mrs write their registers', () => {
  assert.deepEqual(
    armEffects(
      'ldmia sp!, {r4, r5, pc}; ldmia r0, {r1, r2}; stmdb sp!, {r4, lr}; stmia r0, {r1}; mul r0, r1, r2; umull r0, r1, r2, r3; swp r0, r1, [r2]; mrs r0, cpsr; msr cpsr_fc, r0; bx lr',
    ),
    [
      { writes: (1 << 4) | (1 << 5) | (1 << 15) | (1 << 13), from: [] },
      { writes: 0b110, from: [] },
      { writes: 1 << 13, from: [] },
      { writes: 0, from: [] },
      { writes: 1 << 0, from: [] },
      { writes: 0b11, from: [] },
      { writes: 1 << 0, from: [] },
      { writes: 1 << 0, from: [] },
      { writes: 0, from: [] },
      { writes: 0, from: [] },
    ],
  );
});

test('an operand the row lacks throws IsaInvariantError instead of reading as r0', () => {
  assert.deepEqual(effectOf({ writes: ['rd'], from: ['rs'] }, { rd: 1, rs: 2 }, 'thumb.test'), {
    writes: 2,
    from: [2],
  });
  assert.throws(() => effectOf({ writes: ['rd'] }, { rn: 1 }, 'thumb.test'), IsaInvariantError);
  assert.throws(() => effectOf({ reglist: 'reglist' }, { rd: 3 }, 'thumb.test'), /names 'reglist'/);
  assert.throws(() => effectOf({ from: ['rn'] }, { rd: 0 }, 'thumb.test'), IsaInvariantError);
});

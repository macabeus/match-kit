// One test per Thumb row family, on hand-written halfwords: row, text, raw reason, flow, stack.
import { assert, test } from 'vitest';

import { decode } from '../../src/armv4t.js';
import { checkCase } from './cases.js';
import type { RowCase } from './cases.js';

const run = (cases: readonly RowCase[]): void => {
  for (const c of cases) {
    checkCase('thumb', c);
  }
};

test('shifts by immediate: lsl #0 prints as movs, lsr/asr #32 encode as 0', () => {
  run([
    { word: 0x0008, spec: 'thumb.movs_reg', text: 'movs r0, r1', flow: { kind: 'next' } },
    { word: 0x0088, spec: 'thumb.lsl_imm', text: 'lsls r0, r1, #2', fields: { imm: 2, rm: 1, rd: 0 } },
    { word: 0x0808, spec: 'thumb.lsr_imm', text: 'lsrs r0, r1, #0x20' },
    { word: 0x17ff, spec: 'thumb.asr_imm', text: 'asrs r7, r7, #0x1f' },
  ]);
});

test('add and sub: registers, 3-bit and 8-bit immediates', () => {
  run([
    { word: 0x1888, spec: 'thumb.add_reg', text: 'adds r0, r1, r2' },
    { word: 0x1a88, spec: 'thumb.sub_reg', text: 'subs r0, r1, r2' },
    { word: 0x1c48, spec: 'thumb.add_imm3', text: 'adds r0, r1, #1' },
    // rd == rn: as picks the 8-bit form for this text, so the 3-bit encoding has none.
    { word: 0x1c40, spec: 'thumb.add_imm3', raw: 'as-alias' },
    { word: 0x1e40, spec: 'thumb.sub_imm3', raw: 'as-alias' },
    { word: 0x2001, spec: 'thumb.mov_imm', text: 'movs r0, #1' },
    { word: 0x28ff, spec: 'thumb.cmp_imm', text: 'cmp r0, #0xff' },
    { word: 0x3001, spec: 'thumb.add_imm8', text: 'adds r0, #1' },
    { word: 0x3f80, spec: 'thumb.sub_imm8', text: 'subs r7, #0x80' },
  ]);
});

test('the ALU block', () => {
  run([
    { word: 0x4008, spec: 'thumb.and', text: 'ands r0, r1' },
    { word: 0x4088, spec: 'thumb.lsl_reg', text: 'lsls r0, r1' },
    { word: 0x4208, spec: 'thumb.tst', text: 'tst r0, r1' },
    { word: 0x4248, spec: 'thumb.neg', text: 'negs r0, r1' },
    { word: 0x4288, spec: 'thumb.cmp_reg', text: 'cmp r0, r1' },
    { word: 0x4348, spec: 'thumb.mul', text: 'muls r0, r1' },
    { word: 0x43c8, spec: 'thumb.mvn', text: 'mvns r0, r1' },
  ]);
});

test('hi-register operations and bx', () => {
  run([
    { word: 0x4485, spec: 'thumb.add_hi', text: 'add sp, r0' },
    { word: 0x4408, spec: 'thumb.add_hi', raw: 'unpredictable' },
    { word: 0x4487, spec: 'thumb.add_pc', text: 'add pc, r0', flow: { kind: 'indirect', reg: 0, via: 'add-pc' } },
    { word: 0x4545, spec: 'thumb.cmp_hi', text: 'cmp r5, r8' },
    { word: 0x45c5, spec: 'thumb.cmp_hi', text: 'cmp sp, r8' },
    { word: 0x4578, spec: 'thumb.cmp_hi', raw: 'unpredictable' },
    { word: 0x46c0, spec: 'thumb.mov_hi', text: 'mov r8, r8' },
    { word: 0x4608, spec: 'thumb.mov_hi', raw: 'unpredictable' },
    { word: 0x46f7, spec: 'thumb.mov_pc', text: 'mov pc, lr', flow: { kind: 'return', via: 'mov-pc-lr' } },
    { word: 0x4687, spec: 'thumb.mov_pc', text: 'mov pc, r0', flow: { kind: 'indirect', reg: 0, via: 'mov-pc' } },
    { word: 0x4770, spec: 'thumb.bx', text: 'bx lr', flow: { kind: 'return', via: 'bx-lr' } },
    { word: 0x4718, spec: 'thumb.bx', text: 'bx r3', flow: { kind: 'indirect', reg: 3, via: 'bx' } },
    { word: 0x4778, spec: 'thumb.bx', text: 'bx pc', flow: { kind: 'mode-switch', target: 0x0800_0004 } },
    {
      word: 0x4778,
      addr: 0x0800_0002,
      spec: 'thumb.bx',
      text: 'bx pc',
      flow: { kind: 'mode-switch', target: 0x0800_0004 },
    },
    { word: 0x4771, spec: 'thumb.bx', raw: 'sbz-set', flow: { kind: 'return', via: 'bx-lr' } },
    { word: 0x4780, spec: 'thumb.blx_reg', raw: 'unpredictable', flow: { kind: 'invalid' } },
  ]);
});

test('pc-relative load and adr use Align(addr + 4, 4)', () => {
  run([
    {
      word: 0x4801,
      spec: 'thumb.ldr_literal',
      text: 'ldr r0, _08000008',
      flow: { kind: 'pool-load', pool: 0x0800_0008, rd: 0 },
    },
    { word: 0x4801, addr: 0x0800_0002, spec: 'thumb.ldr_literal', text: 'ldr r0, _08000008' },
    { word: 0x4fff, addr: 0x0800_0002, spec: 'thumb.ldr_literal', text: 'ldr r7, _08000400' },
    { word: 0xa001, spec: 'thumb.adr', text: 'adr r0, _08000008', flow: { kind: 'adr', target: 0x0800_0008 } },
    { word: 0xa001, addr: 0x0800_0006, spec: 'thumb.adr', text: 'adr r0, _0800000C' },
  ]);
});

test('loads and stores: register offset, immediate offset, sp-relative', () => {
  run([
    { word: 0x5888, spec: 'thumb.ldr_reg', text: 'ldr r0, [r1, r2]' },
    { word: 0x5688, spec: 'thumb.ldrsb_reg', text: 'ldrsb r0, [r1, r2]' },
    { word: 0x6808, spec: 'thumb.ldr_imm', text: 'ldr r0, [r1]' },
    { word: 0x6848, spec: 'thumb.ldr_imm', text: 'ldr r0, [r1, #4]', fields: { imm: 1 } },
    { word: 0x7fff, spec: 'thumb.ldrb_imm', text: 'ldrb r7, [r7, #0x1f]' },
    { word: 0x8848, spec: 'thumb.ldrh_imm', text: 'ldrh r0, [r1, #2]' },
    { word: 0x9801, spec: 'thumb.ldr_sp', text: 'ldr r0, [sp, #4]' },
    { word: 0x9000, spec: 'thumb.str_sp', text: 'str r0, [sp]' },
    { word: 0xa801, spec: 'thumb.add_sp_rd', text: 'add r0, sp, #4' },
  ]);
});

test('sp adjustments, push and pop carry their stack deltas', () => {
  run([
    { word: 0xb082, spec: 'thumb.sub_sp', text: 'sub sp, #8', stack: -8 },
    { word: 0xb002, spec: 'thumb.add_sp', text: 'add sp, #8', stack: 8 },
    { word: 0xb510, spec: 'thumb.push', text: 'push {r4, lr}', stack: -8 },
    { word: 0xb400, spec: 'thumb.push', raw: 'unpredictable' },
    { word: 0xbd10, spec: 'thumb.pop_pc', text: 'pop {r4, pc}', stack: 8, flow: { kind: 'return', via: 'pop-pc' } },
    { word: 0xbc10, spec: 'thumb.pop', text: 'pop {r4}', stack: 4 },
    { word: 0xbc00, spec: 'thumb.pop', raw: 'unpredictable' },
    { word: 0xb100, spec: 'thumb.undefined', raw: 'undefined', flow: { kind: 'invalid' } },
  ]);
});

test('ldmia and stmia: writeback only when the base is not loaded', () => {
  run([
    { word: 0xc003, spec: 'thumb.stmia', text: 'stmia r0!, {r0, r1}' },
    { word: 0xc103, spec: 'thumb.stmia', raw: 'unpredictable' },
    { word: 0xc803, spec: 'thumb.ldmia', text: 'ldmia r0, {r0, r1}' },
    { word: 0xc802, spec: 'thumb.ldmia', text: 'ldmia r0!, {r1}' },
    // as assembles `ldmia r0, {r0}` as `ldr r0, [r0]`.
    { word: 0xc801, spec: 'thumb.ldmia', raw: 'as-alias' },
  ]);
});

test('branches, swi and the undefined spaces', () => {
  run([
    {
      word: 0xd0fe,
      spec: 'thumb.bcc',
      text: 'beq _08000000',
      flow: { kind: 'branch', target: 0x0800_0000, conditional: true },
    },
    { word: 0xd87f, spec: 'thumb.bcc', text: 'bhi _08000102' },
    { word: 0xde00, spec: 'thumb.b_cond_undefined', raw: 'undefined', flow: { kind: 'invalid' } },
    { word: 0xdf06, spec: 'thumb.swi', text: 'swi #6', flow: { kind: 'swi', imm: 6 } },
    {
      word: 0xe7fe,
      spec: 'thumb.b',
      text: 'b _08000000',
      flow: { kind: 'branch', target: 0x0800_0000, conditional: false },
    },
    { word: 0xe400, spec: 'thumb.b', text: 'b _07FFF804' },
    { word: 0xe800, spec: 'thumb.undefined', raw: 'undefined' },
  ]);
});

test('bl pairs a prefix with the following suffix; a lone half is raw', () => {
  run([
    { word: 0xf800_f000, spec: 'thumb.bl', text: 'bl _08000004', flow: { kind: 'bl', target: 0x0800_0004 } },
    { word: 0xffff_f3ff, spec: 'thumb.bl', text: 'bl _08400002' },
    { word: 0xf800_f400, spec: 'thumb.bl', text: 'bl _07C00004' },
    // Each half is an instruction of its own: the first sets lr, the second jumps through it.
    { word: 0x0000_f000, spec: 'thumb.bl_prefix', raw: 'bl-half', flow: { kind: 'next' } },
    { word: 0xf800, spec: 'thumb.bl_suffix', raw: 'bl-half', flow: { kind: 'indirect', reg: 14, via: 'bl-suffix' } },
  ]);
  assert.strictEqual(decode('thumb', 0xf800_f000, 0x0800_0000).size, 4);
  assert.strictEqual(decode('thumb', 0x2000_f000, 0x0800_0000).size, 2);
  assert.strictEqual(decode('thumb', 0x2000_f000, 0x0800_0000).word, 0xf000);
});

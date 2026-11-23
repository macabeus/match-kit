// One test per ARM row family, on hand-written words: row, text, raw reason, flow, stack.
import { assert, test } from 'vitest';

import { decode } from '../../src/armv4t.js';
import { checkCase } from './cases.js';
import type { RowCase } from './cases.js';

const run = (cases: readonly RowCase[]): void => {
  for (const c of cases) {
    checkCase('arm', c);
  }
};

test('data processing: shifted registers', () => {
  run([
    { word: 0xe1a0_0001, spec: 'arm.mov_reg', text: 'mov r0, r1' },
    { word: 0xe1b0_0101, spec: 'arm.mov_reg', text: 'movs r0, r1, lsl #2' },
    { word: 0xe1a0_0021, spec: 'arm.mov_reg', text: 'mov r0, r1, lsr #0x20' },
    { word: 0xe1a0_0061, spec: 'arm.mov_reg', text: 'mov r0, r1, rrx' },
    { word: 0xe1a0_0211, spec: 'arm.mov_rr', text: 'mov r0, r1, lsl r2' },
    { word: 0x0011_0002, spec: 'arm.and_reg', text: 'andseq r0, r1, r2' },
    { word: 0xe150_0211, spec: 'arm.cmp_rr', text: 'cmp r0, r1, lsl r2' },
    { word: 0xe1a0_f211, spec: 'arm.mov_rr_pc', raw: 'unpredictable' },
    // mov ignores rn, which should be zero.
    { word: 0xe1a1_0001, spec: 'arm.mov_reg', raw: 'sbz-set' },
  ]);
});

test('data processing: rotated immediates as GNU as encodes them', () => {
  run([
    { word: 0xe3a0_0101, spec: 'arm.mov_imm', text: 'mov r0, #0x40000000' },
    // The same value with a non-minimal rotation needs the explicit form.
    { word: 0xe3a0_0104, spec: 'arm.mov_imm', text: 'mov r0, #4, 2' },
    { word: 0xe310_0001, spec: 'arm.tst_imm', text: 'tst r0, #1' },
    { word: 0xe310_1001, spec: 'arm.tst_imm', raw: 'sbz-set' },
    { word: 0xe3c0_04ff, spec: 'arm.bic_imm', text: 'bic r0, r0, #0xff000000' },
    { word: 0xe28d_d008, spec: 'arm.add_imm', text: 'add sp, sp, #8', stack: 8 },
    { word: 0xe24d_d008, spec: 'arm.sub_imm', text: 'sub sp, sp, #8', stack: -8 },
    { word: 0xe281_0008, spec: 'arm.add_imm', text: 'add r0, r1, #8', stack: 0 },
  ]);
});

test('adr: add or sub from pc, as GNU as picks for the label', () => {
  run([
    { word: 0xe28f_0004, spec: 'arm.adr_add', text: 'adr r0, _0800000C', flow: { kind: 'adr', target: 0x0800_000c } },
    { word: 0xe24f_0004, spec: 'arm.adr_sub', text: 'adr r0, _08000004', flow: { kind: 'adr', target: 0x0800_0004 } },
    // A label at pc + 8 assembles as add #0, so sub #0 has no label text.
    { word: 0xe24f_0000, spec: 'arm.adr_sub', raw: 'as-alias' },
    { word: 0xe28f_0104, spec: 'arm.adr_add', raw: 'as-alias' },
  ]);
});

test('writes to pc are table rows with their own flow class', () => {
  run([
    { word: 0xe1a0_f00e, spec: 'arm.mov_reg_pc', text: 'mov pc, lr', flow: { kind: 'return', via: 'mov-pc-lr' } },
    { word: 0xe1b0_f00e, spec: 'arm.mov_reg_pc', text: 'movs pc, lr', flow: { kind: 'return', via: 'mov-pc-lr' } },
    {
      word: 0xe1a0_f001,
      spec: 'arm.mov_reg_pc',
      text: 'mov pc, r1',
      flow: { kind: 'indirect', reg: 1, via: 'mov-pc' },
    },
    {
      word: 0xe08f_f100,
      spec: 'arm.add_reg_pc',
      text: 'add pc, pc, r0, lsl #2',
      flow: { kind: 'indirect', reg: 0, via: 'add-pc' },
    },
    {
      word: 0xe25e_f004,
      spec: 'arm.sub_imm_pc',
      text: 'subs pc, lr, #4',
      flow: { kind: 'indirect', reg: 14, via: 'mov-pc' },
    },
    { word: 0xe12f_ff1e, spec: 'arm.bx', text: 'bx lr', flow: { kind: 'return', via: 'bx-lr' } },
    { word: 0x112f_ff10, spec: 'arm.bx', text: 'bxne r0', flow: { kind: 'indirect', reg: 0, via: 'bx' } },
    { word: 0xe120_0010, spec: 'arm.bx_sbo', raw: 'sbz-set', flow: { kind: 'invalid' } },
  ]);
});

test('multiplies and swaps', () => {
  run([
    { word: 0xe000_0291, spec: 'arm.mul', text: 'mul r0, r1, r2' },
    { word: 0xe000_0190, spec: 'arm.mul', raw: 'unpredictable' },
    { word: 0xe020_3291, spec: 'arm.mla', text: 'mla r0, r1, r2, r3' },
    { word: 0xe081_0392, spec: 'arm.umull', text: 'umull r0, r1, r2, r3' },
    { word: 0x00d1_0392, spec: 'arm.smull', text: 'smullseq r0, r1, r2, r3' },
    { word: 0xe040_0090, spec: 'arm.mul_undefined', raw: 'undefined' },
    { word: 0xe102_0091, spec: 'arm.swp', text: 'swp r0, r1, [r2]' },
    { word: 0x1142_0091, spec: 'arm.swpb', text: 'swpbne r0, r1, [r2]' },
  ]);
});

test('status registers', () => {
  run([
    { word: 0xe10f_0000, spec: 'arm.mrs', text: 'mrs r0, cpsr' },
    { word: 0xe14f_0000, spec: 'arm.mrs', text: 'mrs r0, spsr' },
    { word: 0xe129_f000, spec: 'arm.msr_reg', text: 'msr cpsr_fc, r0' },
    { word: 0xe328_f20f, spec: 'arm.msr_imm', text: 'msr cpsr_f, #0xf0000000' },
    { word: 0xe100_0070, spec: 'arm.misc_undefined', raw: 'undefined', flow: { kind: 'invalid' } },
  ]);
});

test('word and byte transfers, the pool load and the T forms', () => {
  run([
    {
      word: 0xe59f_0004,
      spec: 'arm.ldr_literal',
      text: 'ldr r0, _0800000C',
      flow: { kind: 'pool-load', pool: 0x0800_000c, rd: 0 },
    },
    { word: 0xe51f_0004, spec: 'arm.ldr_literal', text: 'ldr r0, _08000004' },
    { word: 0xe51f_0000, spec: 'arm.ldr_literal', raw: 'as-alias' },
    { word: 0xe591_0004, spec: 'arm.ldr_imm', text: 'ldr r0, [r1, #4]' },
    { word: 0xe591_0000, spec: 'arm.ldr_imm', text: 'ldr r0, [r1]' },
    { word: 0xe511_0000, spec: 'arm.ldr_imm', text: 'ldr r0, [r1, #-0]' },
    { word: 0xe511_0004, spec: 'arm.ldr_imm', text: 'ldr r0, [r1, #-4]' },
    { word: 0xe5b1_0004, spec: 'arm.ldr_imm', text: 'ldr r0, [r1, #4]!' },
    { word: 0xe491_0004, spec: 'arm.ldr_imm', text: 'ldr r0, [r1], #4' },
    { word: 0xe791_0102, spec: 'arm.ldr_reg', text: 'ldr r0, [r1, r2, lsl #2]' },
    { word: 0xe611_0042, spec: 'arm.ldr_reg', text: 'ldr r0, [r1], -r2, asr #0x20' },
    { word: 0xe4b1_0004, spec: 'arm.ldrt_imm', text: 'ldrt r0, [r1], #4' },
    { word: 0x05d1_0000, spec: 'arm.ldrb_imm', text: 'ldrbeq r0, [r1]' },
    { word: 0xe52d_e004, spec: 'arm.str_imm', text: 'str lr, [sp, #-4]!', stack: -4 },
    {
      word: 0xe49d_f004,
      spec: 'arm.ldr_imm_pc',
      text: 'ldr pc, [sp], #4',
      stack: 4,
      flow: { kind: 'return', via: 'pop-pc' },
    },
    {
      word: 0xe591_f000,
      spec: 'arm.ldr_imm_pc',
      text: 'ldr pc, [r1]',
      flow: { kind: 'indirect', reg: 1, via: 'load-pc' },
    },
    // A pc-relative table read is an indirect jump loaded through pc; a pool load into pc keeps its pool and rd 15.
    {
      word: 0xe79f_f100,
      spec: 'arm.ldr_reg_pc',
      text: 'ldr pc, [pc, r0, lsl #2]',
      flow: { kind: 'indirect', reg: 15, via: 'load-pc' },
    },
    {
      word: 0xe59f_f000,
      spec: 'arm.ldr_literal',
      text: 'ldr pc, _08000008',
      flow: { kind: 'pool-load', pool: 0x0800_0008, rd: 15 },
    },
    { word: 0xe5b1_1004, spec: 'arm.ldr_imm', raw: 'unpredictable' },
    { word: 0xe5c1_f000, spec: 'arm.strb_imm', raw: 'unpredictable' },
    { word: 0xe600_0010, spec: 'arm.media_undefined', raw: 'undefined' },
  ]);
});

test('halfword and signed transfers', () => {
  run([
    { word: 0xe1d1_00b2, spec: 'arm.ldrh_imm', text: 'ldrh r0, [r1, #2]' },
    { word: 0xe191_00b2, spec: 'arm.ldrh_reg', text: 'ldrh r0, [r1, r2]' },
    { word: 0xe1d1_00d1, spec: 'arm.ldrsb_imm', text: 'ldrsb r0, [r1, #1]' },
    { word: 0xe1c1_00b2, spec: 'arm.strh_imm', text: 'strh r0, [r1, #2]' },
    { word: 0xe161_0fbf, spec: 'arm.strh_imm', text: 'strh r0, [r1, #-0xff]!' },
    { word: 0xe0d1_00b4, spec: 'arm.ldrh_imm', text: 'ldrh r0, [r1], #4' },
    { word: 0xe1c0_00d0, spec: 'arm.ldrd_strd', raw: 'undefined' },
  ]);
});

test('block transfers: stacks, pop-pc and the user-bank form', () => {
  run([
    { word: 0xe92d_4010, spec: 'arm.stm', text: 'stmdb sp!, {r4, lr}', stack: -8 },
    {
      word: 0xe8bd_8010,
      spec: 'arm.ldm_pc',
      text: 'ldmia sp!, {r4, pc}',
      stack: 8,
      flow: { kind: 'return', via: 'pop-pc' },
    },
    { word: 0xe890_0003, spec: 'arm.ldm', text: 'ldmia r0, {r0, r1}' },
    { word: 0xe8fd_8010, spec: 'arm.ldm_pc', text: 'ldmia sp!, {r4, pc}^' },
    { word: 0xe990_0003, spec: 'arm.ldm', text: 'ldmib r0, {r0, r1}' },
    { word: 0xe810_0003, spec: 'arm.ldm', text: 'ldmda r0, {r0, r1}' },
    { word: 0xe8b0_0003, spec: 'arm.ldm', raw: 'unpredictable' },
    { word: 0xe890_0000, spec: 'arm.ldm', raw: 'unpredictable' },
  ]);
});

test('branches, swi, coprocessor and the never condition', () => {
  run([
    {
      word: 0xea00_0000,
      spec: 'arm.b',
      text: 'b _08000008',
      flow: { kind: 'branch', target: 0x0800_0008, conditional: false },
    },
    {
      word: 0x0a00_0000,
      spec: 'arm.b',
      text: 'beq _08000008',
      flow: { kind: 'branch', target: 0x0800_0008, conditional: true },
    },
    { word: 0xeaff_fffe, spec: 'arm.b', text: 'b _08000000' },
    { word: 0xeb00_0000, spec: 'arm.bl', text: 'bl _08000008', flow: { kind: 'bl', target: 0x0800_0008 } },
    { word: 0xea7f_ffff, spec: 'arm.b', text: 'b _0A000004' },
    { word: 0xef00_0006, spec: 'arm.swi', text: 'swi #6', flow: { kind: 'swi', imm: 6 } },
    { word: 0xee00_0000, spec: 'arm.coprocessor', raw: 'undefined', flow: { kind: 'invalid' } },
    { word: 0xed00_0000, spec: 'arm.coprocessor_transfer', raw: 'undefined' },
    { word: 0xf000_0000, spec: 'arm.nv', raw: 'unpredictable', flow: { kind: 'invalid' } },
  ]);
});

test('every ARM word decodes to some row', () => {
  for (const word of [0, 0xffff_ffff, 0x0123_4567, 0x8000_0000, 0x7fff_ffff]) {
    assert.match(decode('arm', word, 0x0800_0000).specId, /^arm\./);
  }
});

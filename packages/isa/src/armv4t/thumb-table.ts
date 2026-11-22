// The Thumb (ARMv4T) rows: every format of the ARM7TDMI Thumb instruction set, in decode order (the
// first row whose mask matches wins). The 32-bit bl pair is the last row; decode pairs a prefix with
// a following suffix, and a lone half falls to its raw row. Everything here is GNU as unified syntax
// as `arm-none-eabi-as -mcpu=arm7tdmi` accepts it.
import { popcount, fieldValue as v, wrap32 } from './bits.js';
import { branchOffset, branchTarget, pcOf, thumbPoolBase } from './pc-relative.js';
import { blOff, cond, flag, imm, pcRel, reg, reglist, row } from './row.js';
import type { Row, RowOptions } from './row.js';
import type { Fields, RawReason, RegisterSpec } from './types.js';

function T(name: string, options: RowOptions): Row {
  return row(`thumb.${name}`, 'thumb', options);
}

const LOW3 = [reg('rm', 6), reg('rn', 3), reg('rd', 0)];

/** The register effects the rows below share: rd written, followed to nothing or to its sources. */
const RD: readonly string[] = ['rd'];
const WRITES_RD: RegisterSpec = { writes: RD };
/** A call clobbers r0-r3, r12 and lr; a BIOS call r0-r3. */
const CALL_CLOBBERS = 0b0101_0000_0000_1111;
const SWI_CLOBBERS = 0b1111;

// ---------------------------------------------------------------------------------------------------
// Shifts, add/sub, immediates and the ALU block.

const shifts: Row[] = [
  T('movs_reg', {
    mask: 0xffc0,
    match: 0x0000,
    fields: [reg('rm', 3), reg('rd', 0)],
    syntax: 'movs {rd}, {rm}',
    registers: { writes: RD, from: ['rm'] },
  }),
  T('lsl_imm', {
    mask: 0xf800,
    match: 0x0000,
    fields: [imm('imm', 6, 5), reg('rm', 3), reg('rd', 0)],
    syntax: 'lsls {rd}, {rm}, {imm}',
    registers: WRITES_RD,
  }),
  ...(['lsr', 'asr'] as const).map((op, i) =>
    T(`${op}_imm`, {
      mask: 0xf800,
      match: 0x0800 * (i + 1),
      fields: [imm('imm5', 6, 5), reg('rm', 3), reg('rd', 0)],
      syntax: `${op}s {rd}, {rm}, {imm}`,
      registers: WRITES_RD,
      // An amount of 32 is encoded as 0.
      toOps: (f) => ({ rd: v(f, 'rd'), rm: v(f, 'rm'), imm: v(f, 'imm5') === 0 ? 32 : v(f, 'imm5') }),
      fromOps: (o) => {
        const amount = o['imm'] ?? -1;
        return amount < 1 || amount > 32 ? undefined : { rd: v(o, 'rd'), rm: v(o, 'rm'), imm5: amount & 31 };
      },
    }),
  ),
];

/** `adds rd, rd, #imm` assembles to the 8-bit-immediate form, so the 3-bit form with rd == rn cannot print. */
const imm3Raw = (f: Fields): RawReason | null => (v(f, 'rd') === v(f, 'rn') ? 'as-alias' : null);

const addSub: Row[] = [
  T('add_reg', {
    mask: 0xfe00,
    match: 0x1800,
    fields: LOW3,
    syntax: 'adds {rd}, {rn}, {rm}',
    registers: { writes: RD, from: ['rn', 'rm'] },
  }),
  T('sub_reg', { mask: 0xfe00, match: 0x1a00, fields: LOW3, syntax: 'subs {rd}, {rn}, {rm}', registers: WRITES_RD }),
  T('add_imm3', {
    mask: 0xfe00,
    match: 0x1c00,
    fields: [imm('imm', 6, 3), reg('rn', 3), reg('rd', 0)],
    syntax: 'adds {rd}, {rn}, {imm}',
    asPriority: 1,
    raw: imm3Raw,
    registers: { writes: RD, from: ['rn'] },
  }),
  T('sub_imm3', {
    mask: 0xfe00,
    match: 0x1e00,
    fields: [imm('imm', 6, 3), reg('rn', 3), reg('rd', 0)],
    syntax: 'subs {rd}, {rn}, {imm}',
    asPriority: 1,
    raw: imm3Raw,
    registers: WRITES_RD,
  }),
  T('mov_imm', {
    mask: 0xf800,
    match: 0x2000,
    fields: [reg('rd', 8), imm('imm', 0, 8)],
    syntax: 'movs {rd}, {imm}',
    registers: WRITES_RD,
  }),
  T('cmp_imm', { mask: 0xf800, match: 0x2800, fields: [reg('rn', 8), imm('imm', 0, 8)], syntax: 'cmp {rn}, {imm}' }),
  T('add_imm8', {
    mask: 0xf800,
    match: 0x3000,
    fields: [reg('rd', 8), imm('imm', 0, 8)],
    syntax: 'adds {rd}, {imm}',
    aliases: ['adds {rd}, {rd}, {imm}'],
    registers: { writes: RD, from: RD },
  }),
  T('sub_imm8', {
    mask: 0xf800,
    match: 0x3800,
    fields: [reg('rd', 8), imm('imm', 0, 8)],
    syntax: 'subs {rd}, {imm}',
    aliases: ['subs {rd}, {rd}, {imm}'],
    registers: WRITES_RD,
  }),
];

/** The 16 ALU operations of format 4, in opcode order: [name, syntax, first operand, second operand]. */
const ALU: readonly (readonly [string, string, string, string])[] = [
  ['and', 'ands', 'rd', 'rm'],
  ['eor', 'eors', 'rd', 'rm'],
  ['lsl_reg', 'lsls', 'rd', 'rs'],
  ['lsr_reg', 'lsrs', 'rd', 'rs'],
  ['asr_reg', 'asrs', 'rd', 'rs'],
  ['adc', 'adcs', 'rd', 'rm'],
  ['sbc', 'sbcs', 'rd', 'rm'],
  ['ror_reg', 'rors', 'rd', 'rs'],
  ['tst', 'tst', 'rn', 'rm'],
  ['neg', 'negs', 'rd', 'rm'],
  ['cmp_reg', 'cmp', 'rn', 'rm'],
  ['cmn', 'cmn', 'rn', 'rm'],
  ['orr', 'orrs', 'rd', 'rm'],
  ['mul', 'muls', 'rd', 'rm'],
  ['bic', 'bics', 'rd', 'rm'],
  ['mvn', 'mvns', 'rd', 'rm'],
];

const alu: Row[] = ALU.map(([name, mnemonic, first, second], op) =>
  T(name, {
    mask: 0xffc0,
    match: 0x4000 | (op << 6),
    fields: [reg(second, 3), reg(first, 0)],
    syntax: `${mnemonic} {${first}}, {${second}}`,
    // tst, cmp and cmn name their first register rn: they write only the flags.
    ...(first === 'rd' ? { registers: WRITES_RD } : {}),
  }),
);

// ---------------------------------------------------------------------------------------------------
// Hi-register operations and bx (format 5). The 4-bit registers are H:R3.

const HI_FIELDS = [flag('hd', 7), flag('hm', 6), reg('rm3', 3), reg('rd3', 0)];

/** The hi-register texts GNU as rejects: two low registers, and cmp with pc. */
function hiRefused(op: number, f: Fields): boolean {
  if (v(f, 'hd') === 0 && v(f, 'hm') === 0) {
    return true;
  }
  return op === 1 && (((v(f, 'hd') << 3) | v(f, 'rd3')) === 15 || ((v(f, 'hm') << 3) | v(f, 'rm3')) === 15);
}

function hiRow(
  name: string,
  op: number,
  first: 'rd' | 'rn',
  mnemonic: string,
  asPriority: number,
  registers?: RegisterSpec,
): Row {
  return T(name, {
    ...(registers === undefined ? {} : { registers }),
    mask: 0xff00,
    match: 0x4400 | (op << 8),
    fields: HI_FIELDS,
    syntax: `${mnemonic} {${first}}, {rm}`,
    asPriority,
    toOps: (f) => ({ [first]: (v(f, 'hd') << 3) | v(f, 'rd3'), rm: (v(f, 'hm') << 3) | v(f, 'rm3') }),
    fromOps: (o) => {
      const d = o[first] ?? 0;
      const m = o['rm'] ?? 0;
      return { hd: d >> 3, rd3: d & 7, hm: m >> 3, rm3: m & 7 };
    },
    // ARMv4T: both registers low is UNPREDICTABLE, and `as` refuses the text for this architecture;
    // cmp with pc as either operand is UNPREDICTABLE too (as: "r15 not allowed here").
    raw: (f) => (hiRefused(op, f) ? 'unpredictable' : null),
    refuse: (f) => hiRefused(op, f),
  });
}

/** `add pc, rm` and `mov pc, rm`: the hi-register forms that write pc (H1 = 1, Rd = 7). */
function pcWriteRow(name: string, op: number, mnemonic: string, flow: 'add-pc' | 'mov-pc'): Row {
  return T(name, {
    mask: 0xff87,
    match: 0x4487 | (op << 8),
    fields: [flag('hm', 6), reg('rm3', 3)],
    syntax: `${mnemonic} {rd}, {rm}`,
    flow,
    toOps: (f) => ({ rd: 15, rm: (v(f, 'hm') << 3) | v(f, 'rm3') }),
    fromOps: (o) => (o['rd'] === 15 ? { hm: v(o, 'rm') >> 3, rm3: v(o, 'rm') & 7 } : undefined),
  });
}

const hi: Row[] = [
  pcWriteRow('add_pc', 0, 'add', 'add-pc'),
  hiRow('add_hi', 0, 'rd', 'add', 0, { writes: RD, from: ['rd', 'rm'] }),
  hiRow('cmp_hi', 1, 'rn', 'cmp', 1),
  pcWriteRow('mov_pc', 2, 'mov', 'mov-pc'),
  hiRow('mov_hi', 2, 'rd', 'mov', 0, { writes: RD, from: ['rm'] }),
  T('bx', {
    mask: 0xff80,
    match: 0x4700,
    fields: [flag('hm', 6), reg('rm3', 3), imm('sbz', 0, 3)],
    syntax: 'bx {rm}',
    flow: 'bx',
    toOps: (f) => ({ rm: (v(f, 'hm') << 3) | v(f, 'rm3') }),
    fromOps: (o) => ({ hm: v(o, 'rm') >> 3, rm3: v(o, 'rm') & 7, sbz: 0 }),
    raw: (f) => (v(f, 'sbz') !== 0 ? 'sbz-set' : null),
  }),
  // H1 = 1 is blx in ARMv5T; on the ARMv4T it is UNPREDICTABLE.
  T('blx_reg', {
    mask: 0xff80,
    match: 0x4780,
    fields: [flag('hm', 6), reg('rm3', 3), imm('sbz', 0, 3)],
    syntax: 'blx {rm}',
    rawOnly: 'unpredictable',
    toOps: (f) => ({ rm: (v(f, 'hm') << 3) | v(f, 'rm3') }),
  }),
];

// ---------------------------------------------------------------------------------------------------
// Loads and stores.

const pcLoads: Row[] = [
  T('ldr_pc', {
    mask: 0xf800,
    match: 0x4800,
    fields: [reg('rd', 8), pcRel('imm', 0, 8, 4)],
    syntax: 'ldr {rd}, {target}',
    flow: 'pc-load',
    registers: WRITES_RD,
    toOps: (f, a) => ({ rd: v(f, 'rd'), target: wrap32(thumbPoolBase(a) + v(f, 'imm') * 4) }),
    fromOps: (o, a) => ({ rd: v(o, 'rd'), imm: (v(o, 'target') - thumbPoolBase(a)) / 4 }),
  }),
];

const REG_OFFSET: readonly string[] = ['str', 'strh', 'strb', 'ldrsb', 'ldr', 'ldrh', 'ldrb', 'ldrsh'];

/** A load writes rd; a word load is followed to its address registers. */
function loadRegisters(op: string, address: readonly string[]): { readonly registers?: RegisterSpec } {
  if (!op.startsWith('ldr')) {
    return {};
  }
  return { registers: op === 'ldr' ? { writes: RD, from: address } : WRITES_RD };
}

const regOffset: Row[] = REG_OFFSET.map((op, i) =>
  T(`${op}_reg`, {
    mask: 0xfe00,
    match: 0x5000 | (i << 9),
    fields: LOW3,
    syntax: `${op} {rd}, [{rn}, {rm}]`,
    ...loadRegisters(op, ['rn', 'rm']),
  }),
);

const IMM_OFFSET: readonly (readonly [string, number, number])[] = [
  ['str', 0x6000, 4],
  ['ldr', 0x6800, 4],
  ['strb', 0x7000, 1],
  ['ldrb', 0x7800, 1],
  ['strh', 0x8000, 2],
  ['ldrh', 0x8800, 2],
];

const immOffset: Row[] = IMM_OFFSET.map(([op, match, scale]) =>
  T(`${op}_imm`, {
    mask: 0xf800,
    match,
    fields: [imm('imm', 6, 5, scale), reg('rn', 3), reg('rd', 0)],
    syntax: `${op} {rd}, [{rn}{off}]`,
    ...loadRegisters(op, ['rn']),
  }),
);

const spRelative: Row[] = [
  T('str_sp', {
    mask: 0xf800,
    match: 0x9000,
    fields: [reg('rd', 8), imm('imm', 0, 8, 4)],
    syntax: 'str {rd}, [sp{off}]',
  }),
  T('ldr_sp', {
    mask: 0xf800,
    match: 0x9800,
    fields: [reg('rd', 8), imm('imm', 0, 8, 4)],
    syntax: 'ldr {rd}, [sp{off}]',
    registers: WRITES_RD,
  }),
  T('adr', {
    mask: 0xf800,
    match: 0xa000,
    fields: [reg('rd', 8), pcRel('imm', 0, 8, 4)],
    syntax: 'adr {rd}, {target}',
    flow: 'adr',
    registers: WRITES_RD,
    toOps: (f, a) => ({ rd: v(f, 'rd'), target: wrap32(thumbPoolBase(a) + v(f, 'imm') * 4) }),
    fromOps: (o, a) => ({ rd: v(o, 'rd'), imm: (v(o, 'target') - thumbPoolBase(a)) / 4 }),
  }),
  T('add_sp_rd', {
    mask: 0xf800,
    match: 0xa800,
    fields: [reg('rd', 8), imm('imm', 0, 8, 4)],
    syntax: 'add {rd}, sp, {imm}',
    registers: WRITES_RD,
  }),
  T('add_sp', {
    mask: 0xff80,
    match: 0xb000,
    fields: [imm('imm', 0, 7, 4)],
    syntax: 'add sp, {imm}',
    stack: (f) => v(f, 'imm') * 4,
  }),
  T('sub_sp', {
    mask: 0xff80,
    match: 0xb080,
    fields: [imm('imm', 0, 7, 4)],
    syntax: 'sub sp, {imm}',
    stack: (f) => -v(f, 'imm') * 4,
  }),
];

// ---------------------------------------------------------------------------------------------------
// push, pop and the multiple transfers.

const emptyList = (f: Fields): RawReason | null => (v(f, 'rlist') === 0 ? 'unpredictable' : null);

const stack: Row[] = [
  T('push', {
    mask: 0xfe00,
    match: 0xb400,
    fields: [flag('lr', 8), reglist('rlist', 0, 8)],
    syntax: 'push {list}',
    toOps: (f) => ({ list: v(f, 'rlist') | (v(f, 'lr') << 14) }),
    fromOps: (o) => ({ rlist: v(o, 'list') & 0xff, lr: (v(o, 'list') >> 14) & 1 }),
    stack: (f) => -4 * (popcount(v(f, 'rlist')) + v(f, 'lr')),
    raw: (f) => (v(f, 'rlist') === 0 && v(f, 'lr') === 0 ? 'unpredictable' : null),
    refuse: (f) => v(f, 'rlist') === 0 && v(f, 'lr') === 0,
  }),
  T('pop_pc', {
    mask: 0xff00,
    match: 0xbd00,
    fields: [reglist('rlist', 0, 8)],
    syntax: 'pop {list}',
    flow: 'pop-pc',
    registers: { list: 'list' },
    toOps: (f) => ({ list: v(f, 'rlist') | 0x8000 }),
    fromOps: (o) => ({ rlist: v(o, 'list') & 0xff }),
    stack: (f) => 4 * (popcount(v(f, 'rlist')) + 1),
  }),
  T('pop', {
    mask: 0xff00,
    match: 0xbc00,
    fields: [reglist('rlist', 0, 8)],
    syntax: 'pop {list}',
    toOps: (f) => ({ list: v(f, 'rlist') }),
    fromOps: (o) => ({ rlist: v(o, 'list') }),
    stack: (f) => 4 * popcount(v(f, 'rlist')),
    registers: { list: 'list' },
    raw: emptyList,
    refuse: (f) => v(f, 'rlist') === 0,
  }),
  T('stmia', {
    mask: 0xf800,
    match: 0xc000,
    fields: [reg('rn', 8), reglist('rlist', 0, 8)],
    syntax: 'stmia {rn}!, {list}',
    registers: { writes: ['rn'] },
    toOps: (f) => ({ rn: v(f, 'rn'), list: v(f, 'rlist') }),
    fromOps: (o) => ({ rn: v(o, 'rn'), rlist: v(o, 'list') }),
    // The base in the list stores an UNKNOWN value unless it is the lowest register.
    raw: (f) => {
      const list = v(f, 'rlist');
      const base = 1 << v(f, 'rn');
      if (list === 0) {
        return 'unpredictable';
      }
      return (list & base) !== 0 && (list & (base - 1)) !== 0 ? 'unpredictable' : null;
    },
  }),
  T('ldmia', {
    mask: 0xf800,
    match: 0xc800,
    fields: [reg('rn', 8), reglist('rlist', 0, 8)],
    // Writeback happens only when the base is not loaded, and the text says which.
    syntax: 'ldmia {rn}{wb}, {list}',
    registers: { writes: ['rn'], list: 'list' },
    toOps: (f) => ({ rn: v(f, 'rn'), list: v(f, 'rlist'), w: (v(f, 'rlist') >> v(f, 'rn')) & 1 ? 0 : 1 }),
    // as assembles `ldmia rn, {rn}` as `ldr rn, [rn]`, so that encoding has no text.
    fromOps: (o) => (v(o, 'list') === 1 << v(o, 'rn') ? undefined : { rn: v(o, 'rn'), rlist: v(o, 'list') }),
    raw: (f) => (v(f, 'rlist') === 1 << v(f, 'rn') ? 'as-alias' : emptyList(f)),
  }),
];

// ---------------------------------------------------------------------------------------------------
// Branches, swi and the undefined spaces.

const branches: Row[] = [
  T('b_cond_undefined', {
    mask: 0xff00,
    match: 0xde00,
    fields: [imm('imm', 0, 8)],
    syntax: 'undefined',
    rawOnly: 'undefined',
  }),
  T('swi', {
    mask: 0xff00,
    match: 0xdf00,
    fields: [imm('imm', 0, 8)],
    syntax: 'swi {imm}',
    flow: 'swi',
    registers: { fixed: SWI_CLOBBERS },
  }),
  T('bcc', {
    mask: 0xf000,
    match: 0xd000,
    fields: [cond(8), pcRel('imm', 0, 8, 2)],
    syntax: 'b{c} {target}',
    flow: 'cond-branch',
    toOps: (f, a) => ({ cond: v(f, 'cond'), target: branchTarget(pcOf(a, 'thumb'), v(f, 'imm'), 8, 2) }),
    fromOps: (o, a) => {
      const offset = branchOffset(pcOf(a, 'thumb'), v(o, 'target'), 8, 2);
      const c = o['cond'] ?? 14;
      return offset === undefined || c > 13 ? undefined : { cond: c, imm: offset };
    },
  }),
  T('b', {
    mask: 0xf800,
    match: 0xe000,
    fields: [pcRel('imm', 0, 11, 2)],
    syntax: 'b {target}',
    flow: 'branch',
    toOps: (f, a) => ({ target: branchTarget(pcOf(a, 'thumb'), v(f, 'imm'), 11, 2) }),
    fromOps: (o, a) => {
      const offset = branchOffset(pcOf(a, 'thumb'), v(o, 'target'), 11, 2);
      return offset === undefined ? undefined : { imm: offset };
    },
  }),
  T('bl_prefix', { mask: 0xf800, match: 0xf000, fields: [blOff('hi', 0)], syntax: 'bl prefix', rawOnly: 'undefined' }),
  T('bl_suffix', { mask: 0xf800, match: 0xf800, fields: [blOff('lo', 0)], syntax: 'bl suffix', rawOnly: 'undefined' }),
  T('undefined', { mask: 0, match: 0, syntax: 'undefined', rawOnly: 'undefined' }),
];

/** The 32-bit bl pair: the prefix in the low halfword, the suffix in the high one. */
export const THUMB_BL: Row = T('bl', {
  mask: 0xf800_f800,
  match: 0xf800_f000,
  size: 4,
  fields: [blOff('hi', 0), blOff('lo', 16)],
  syntax: 'bl {target}',
  flow: 'bl',
  registers: { fixed: CALL_CLOBBERS },
  toOps: (f, a) => ({ target: branchTarget(pcOf(a, 'thumb'), (v(f, 'hi') << 11) | v(f, 'lo'), 22, 2) }),
  fromOps: (o, a) => {
    const offset = branchOffset(pcOf(a, 'thumb'), v(o, 'target'), 22, 2);
    return offset === undefined ? undefined : { hi: offset >>> 11, lo: offset & 0x7ff };
  },
});

/** Every 16-bit Thumb row in decode order; the last one matches everything. */
export const THUMB_ROWS: readonly Row[] = [
  ...shifts,
  ...addSub,
  ...alu,
  ...hi,
  ...pcLoads,
  ...regOffset,
  ...immOffset,
  ...spRelative,
  ...stack,
  ...branches,
];

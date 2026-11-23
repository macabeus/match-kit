// The Thumb (ARMv4T) rows: every format of the ARM7TDMI Thumb instruction set, in decode order (the
// first row whose mask matches wins). The 32-bit bl pair is the last row; decode pairs a prefix with
// a following suffix, and a lone half falls to its raw row. Everything here is GNU as unified syntax
// as `arm-none-eabi-as -mcpu=arm7tdmi` accepts it.
import { popcount, wrap32 } from '../bits.js';
import { COND_AL, LR, PC } from '../names.js';
import type { Fields, OperandName, RawReason, RegisterSpec } from '../types.js';
import { bits, operand } from './access.js';
import { branchOffset, branchTarget, pcOf, thumbAlignedPc } from './pc-relative.js';
import { type Row, type RowOptions, blOff, cond, flag, imm, pcRel, reg, reglist, row } from './row.js';

function thumb(name: string, options: RowOptions): Row {
  return row(`thumb.${name}`, 'thumb', options);
}

const LOW3 = [reg('rm', 6), reg('rn', 3), reg('rd', 0)];

/** The register effects the rows below share: rd written, followed to nothing or to its sources. */
const RD: readonly OperandName[] = ['rd'];
const WRITES_RD: RegisterSpec = { writes: RD };
/**
 * A bl, whole or in halves, writes lr. What the callee does to other registers is a calling convention's, not the
 * instruction's, so it is not here.
 */
const WRITES_LR: RegisterSpec = { fixed: 1 << LR };

/** The register number of a hi-register operand: its H bit above its three low bits. */
const hiRegister = (f: Fields, h: string, low: string): number => (bits(f, h) << 3) | bits(f, low);

// ---------------------------------------------------------------------------------------------------
// Shifts, add/sub, immediates and the ALU block.

const shifts: Row[] = [
  thumb('movs_reg', {
    mask: 0xffc0,
    match: 0x0000,
    fields: [reg('rm', 3), reg('rd', 0)],
    syntax: 'movs {rd}, {rm}',
    registers: { writes: RD, from: ['rm'] },
  }),
  thumb('lsl_imm', {
    mask: 0xf800,
    match: 0x0000,
    fields: [imm('imm', 6, 5), reg('rm', 3), reg('rd', 0)],
    syntax: 'lsls {rd}, {rm}, {imm}',
    registers: WRITES_RD,
  }),
  ...(['lsr', 'asr'] as const).map((op, i) =>
    thumb(`${op}_imm`, {
      mask: 0xf800,
      match: 0x0800 * (i + 1),
      fields: [imm('imm5', 6, 5), reg('rm', 3), reg('rd', 0)],
      syntax: `${op}s {rd}, {rm}, {imm}`,
      registers: WRITES_RD,
      // An amount of 32 is encoded as 0.
      toOperands: (f) => ({ rd: bits(f, 'rd'), rm: bits(f, 'rm'), imm: bits(f, 'imm5') === 0 ? 32 : bits(f, 'imm5') }),
      fromOperands: (o) => {
        const amount = o.imm ?? -1;
        return amount < 1 || amount > 32
          ? undefined
          : { rd: operand(o, 'rd'), rm: operand(o, 'rm'), imm5: amount & 31 };
      },
    }),
  ),
];

/** `adds rd, rd, #imm` assembles to the 8-bit-immediate form, so the 3-bit form with rd == rn cannot print. */
const imm3Raw = (f: Fields): RawReason | null => (bits(f, 'rd') === bits(f, 'rn') ? 'as-alias' : null);

const addSub: Row[] = [
  thumb('add_reg', {
    mask: 0xfe00,
    match: 0x1800,
    fields: LOW3,
    syntax: 'adds {rd}, {rn}, {rm}',
    registers: { writes: RD, from: ['rn', 'rm'] },
  }),
  thumb('sub_reg', {
    mask: 0xfe00,
    match: 0x1a00,
    fields: LOW3,
    syntax: 'subs {rd}, {rn}, {rm}',
    registers: WRITES_RD,
  }),
  thumb('add_imm3', {
    mask: 0xfe00,
    match: 0x1c00,
    fields: [imm('imm', 6, 3), reg('rn', 3), reg('rd', 0)],
    syntax: 'adds {rd}, {rn}, {imm}',
    asPriority: 1,
    raw: imm3Raw,
    registers: { writes: RD, from: ['rn'] },
  }),
  thumb('sub_imm3', {
    mask: 0xfe00,
    match: 0x1e00,
    fields: [imm('imm', 6, 3), reg('rn', 3), reg('rd', 0)],
    syntax: 'subs {rd}, {rn}, {imm}',
    asPriority: 1,
    raw: imm3Raw,
    registers: WRITES_RD,
  }),
  thumb('mov_imm', {
    mask: 0xf800,
    match: 0x2000,
    fields: [reg('rd', 8), imm('imm', 0, 8)],
    syntax: 'movs {rd}, {imm}',
    registers: WRITES_RD,
  }),
  thumb('cmp_imm', {
    mask: 0xf800,
    match: 0x2800,
    fields: [reg('rn', 8), imm('imm', 0, 8)],
    syntax: 'cmp {rn}, {imm}',
  }),
  thumb('add_imm8', {
    mask: 0xf800,
    match: 0x3000,
    fields: [reg('rd', 8), imm('imm', 0, 8)],
    syntax: 'adds {rd}, {imm}',
    aliases: ['adds {rd}, {rd}, {imm}'],
    registers: { writes: RD, from: RD },
  }),
  thumb('sub_imm8', {
    mask: 0xf800,
    match: 0x3800,
    fields: [reg('rd', 8), imm('imm', 0, 8)],
    syntax: 'subs {rd}, {imm}',
    aliases: ['subs {rd}, {rd}, {imm}'],
    registers: WRITES_RD,
  }),
];

interface AluOperation {
  readonly name: string;
  readonly mnemonic: string;
  /** tst, cmp and cmn name their first register rn: they write only the flags. */
  readonly first: 'rd' | 'rn';
  readonly second: 'rm' | 'rs';
}

const alu = (name: string, mnemonic: string, first: 'rd' | 'rn' = 'rd', second: 'rm' | 'rs' = 'rm'): AluOperation => ({
  name,
  mnemonic,
  first,
  second,
});

/** The 16 ALU operations of format 4, in opcode order. */
const ALU: readonly AluOperation[] = [
  alu('and', 'ands'),
  alu('eor', 'eors'),
  alu('lsl_reg', 'lsls', 'rd', 'rs'),
  alu('lsr_reg', 'lsrs', 'rd', 'rs'),
  alu('asr_reg', 'asrs', 'rd', 'rs'),
  alu('adc', 'adcs'),
  alu('sbc', 'sbcs'),
  alu('ror_reg', 'rors', 'rd', 'rs'),
  alu('tst', 'tst', 'rn'),
  alu('neg', 'negs'),
  alu('cmp_reg', 'cmp', 'rn'),
  alu('cmn', 'cmn', 'rn'),
  alu('orr', 'orrs'),
  alu('mul', 'muls'),
  alu('bic', 'bics'),
  alu('mvn', 'mvns'),
];

const aluRows: Row[] = ALU.map(({ name, mnemonic, first, second }, opcode) =>
  thumb(name, {
    mask: 0xffc0,
    match: 0x4000 | (opcode << 6),
    fields: [reg(second, 3), reg(first, 0)],
    syntax: `${mnemonic} {${first}}, {${second}}`,
    ...(first === 'rd' ? { registers: WRITES_RD } : {}),
  }),
);

// ---------------------------------------------------------------------------------------------------
// Hi-register operations and bx (format 5). The 4-bit registers are H:R3.

const HI_FIELDS = [flag('h1', 7), flag('h2', 6), reg('rm3', 3), reg('rd3', 0)];

const HI_OPCODE = { add: 0, cmp: 1, mov: 2 } as const;
type HiOperation = keyof typeof HI_OPCODE;

interface HiRow {
  readonly name: string;
  readonly operation: HiOperation;
  /** cmp names its first register rn: it writes only the flags. */
  readonly first: 'rd' | 'rn';
  readonly asPriority?: number;
  readonly registers?: RegisterSpec;
}

/**
 * The hi-register texts GNU as rejects. ARMv4T: both registers low is UNPREDICTABLE, and `as` refuses the text
 * for this architecture; cmp with pc as either operand is UNPREDICTABLE too (as: "r15 not allowed here").
 */
function hiRejected(operation: HiOperation, f: Fields): boolean {
  if (bits(f, 'h1') === 0 && bits(f, 'h2') === 0) {
    return true;
  }
  return operation === 'cmp' && (hiRegister(f, 'h1', 'rd3') === PC || hiRegister(f, 'h2', 'rm3') === PC);
}

function hiRow({ name, operation, first, asPriority = 0, registers }: HiRow): Row {
  return thumb(name, {
    ...(registers === undefined ? {} : { registers }),
    mask: 0xff00,
    match: 0x4400 | (HI_OPCODE[operation] << 8),
    fields: HI_FIELDS,
    syntax: `${operation} {${first}}, {rm}`,
    asPriority,
    toOperands: (f) => ({ [first]: hiRegister(f, 'h1', 'rd3'), rm: hiRegister(f, 'h2', 'rm3') }),
    fromOperands: (o) => {
      const d = operand(o, first);
      const m = operand(o, 'rm');
      return { h1: d >> 3, rd3: d & 7, h2: m >> 3, rm3: m & 7 };
    },
    rejected: { reason: 'unpredictable', when: (f) => hiRejected(operation, f) },
  });
}

/** `add pc, rm` and `mov pc, rm`: the hi-register forms that write pc (H1 = 1, Rd = 7). */
function pcWriteRow(operation: 'add' | 'mov'): Row {
  return thumb(`${operation}_pc`, {
    mask: 0xff87,
    match: 0x4487 | (HI_OPCODE[operation] << 8),
    fields: [flag('h2', 6), reg('rm3', 3)],
    syntax: `${operation} {rd}, {rm}`,
    flow: `${operation}-pc`,
    registers: WRITES_RD,
    toOperands: (f) => ({ rd: PC, rm: hiRegister(f, 'h2', 'rm3') }),
    fromOperands: (o) => (o.rd === PC ? { h2: operand(o, 'rm') >> 3, rm3: operand(o, 'rm') & 7 } : undefined),
  });
}

const BX_FIELDS = [flag('h2', 6), reg('rm3', 3), imm('sbz', 0, 3)];

const hi: Row[] = [
  pcWriteRow('add'),
  hiRow({ name: 'add_hi', operation: 'add', first: 'rd', registers: { writes: RD, from: ['rd', 'rm'] } }),
  hiRow({ name: 'cmp_hi', operation: 'cmp', first: 'rn', asPriority: 1 }),
  pcWriteRow('mov'),
  hiRow({ name: 'mov_hi', operation: 'mov', first: 'rd', registers: { writes: RD, from: ['rm'] } }),
  thumb('bx', {
    mask: 0xff80,
    match: 0x4700,
    fields: BX_FIELDS,
    syntax: 'bx {rm}',
    flow: 'bx',
    toOperands: (f) => ({ rm: hiRegister(f, 'h2', 'rm3') }),
    fromOperands: (o) => ({ h2: operand(o, 'rm') >> 3, rm3: operand(o, 'rm') & 7, sbz: 0 }),
    raw: (f) => (bits(f, 'sbz') !== 0 ? 'sbz-set' : null),
  }),
  // H1 = 1 is blx in ARMv5T; on the ARMv4T it is UNPREDICTABLE.
  thumb('blx_reg', {
    mask: 0xff80,
    match: 0x4780,
    fields: BX_FIELDS,
    syntax: 'blx {rm}',
    rawOnly: 'unpredictable',
    toOperands: (f) => ({ rm: hiRegister(f, 'h2', 'rm3') }),
  }),
];

// ---------------------------------------------------------------------------------------------------
// Loads and stores.

const pcLoads: Row[] = [
  thumb('ldr_literal', {
    mask: 0xf800,
    match: 0x4800,
    fields: [reg('rd', 8), pcRel('imm', 0, 8, 4)],
    syntax: 'ldr {rd}, {target}',
    flow: 'pool-load',
    registers: WRITES_RD,
    toOperands: (f, a) => ({ rd: bits(f, 'rd'), target: wrap32(thumbAlignedPc(a) + bits(f, 'imm') * 4) }),
    fromOperands: (o, a) => ({ rd: operand(o, 'rd'), imm: (operand(o, 'target') - thumbAlignedPc(a)) / 4 }),
  }),
];

const REG_OFFSET: readonly string[] = ['str', 'strh', 'strb', 'ldrsb', 'ldr', 'ldrh', 'ldrb', 'ldrsh'];

/** A load writes rd; a word load is followed to its address registers. */
function loadRegisters(op: string, address: readonly OperandName[]): { readonly registers?: RegisterSpec } {
  if (!op.startsWith('ldr')) {
    return {};
  }
  return { registers: op === 'ldr' ? { writes: RD, from: address } : WRITES_RD };
}

const regOffset: Row[] = REG_OFFSET.map((op, i) =>
  thumb(`${op}_reg`, {
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
  thumb(`${op}_imm`, {
    mask: 0xf800,
    match,
    fields: [imm('imm', 6, 5, scale), reg('rn', 3), reg('rd', 0)],
    syntax: `${op} {rd}, [{rn}{off}]`,
    ...loadRegisters(op, ['rn']),
  }),
);

const spRelative: Row[] = [
  thumb('str_sp', {
    mask: 0xf800,
    match: 0x9000,
    fields: [reg('rd', 8), imm('imm', 0, 8, 4)],
    syntax: 'str {rd}, [sp{off}]',
  }),
  thumb('ldr_sp', {
    mask: 0xf800,
    match: 0x9800,
    fields: [reg('rd', 8), imm('imm', 0, 8, 4)],
    syntax: 'ldr {rd}, [sp{off}]',
    registers: WRITES_RD,
  }),
  thumb('adr', {
    mask: 0xf800,
    match: 0xa000,
    fields: [reg('rd', 8), pcRel('imm', 0, 8, 4)],
    syntax: 'adr {rd}, {target}',
    flow: 'adr',
    registers: WRITES_RD,
    toOperands: (f, a) => ({ rd: bits(f, 'rd'), target: wrap32(thumbAlignedPc(a) + bits(f, 'imm') * 4) }),
    fromOperands: (o, a) => ({ rd: operand(o, 'rd'), imm: (operand(o, 'target') - thumbAlignedPc(a)) / 4 }),
  }),
  thumb('add_sp_rd', {
    mask: 0xf800,
    match: 0xa800,
    fields: [reg('rd', 8), imm('imm', 0, 8, 4)],
    syntax: 'add {rd}, sp, {imm}',
    registers: WRITES_RD,
  }),
  thumb('add_sp', {
    mask: 0xff80,
    match: 0xb000,
    fields: [imm('imm', 0, 7, 4)],
    syntax: 'add sp, {imm}',
    stack: (f) => bits(f, 'imm') * 4,
  }),
  thumb('sub_sp', {
    mask: 0xff80,
    match: 0xb080,
    fields: [imm('imm', 0, 7, 4)],
    syntax: 'sub sp, {imm}',
    stack: (f) => -bits(f, 'imm') * 4,
  }),
];

// ---------------------------------------------------------------------------------------------------
// push, pop and the multiple transfers.

const isEmptyList = (f: Fields): boolean => bits(f, 'reglist') === 0;
const emptyList = (f: Fields): RawReason | null => (isEmptyList(f) ? 'unpredictable' : null);

const stack: Row[] = [
  thumb('push', {
    mask: 0xfe00,
    match: 0xb400,
    fields: [flag('lr', 8), reglist('reglist', 0, 8)],
    syntax: 'push {reglist}',
    toOperands: (f) => ({ reglist: bits(f, 'reglist') | (bits(f, 'lr') << LR) }),
    fromOperands: (o) => ({ reglist: operand(o, 'reglist') & 0xff, lr: (operand(o, 'reglist') >> LR) & 1 }),
    stack: (f) => -4 * (popcount(bits(f, 'reglist')) + bits(f, 'lr')),
    rejected: { reason: 'unpredictable', when: (f) => bits(f, 'reglist') === 0 && bits(f, 'lr') === 0 },
  }),
  thumb('pop_pc', {
    mask: 0xff00,
    match: 0xbd00,
    fields: [reglist('reglist', 0, 8)],
    syntax: 'pop {reglist}',
    flow: 'load-pc',
    registers: { reglist: 'reglist' },
    toOperands: (f) => ({ reglist: bits(f, 'reglist') | (1 << PC) }),
    fromOperands: (o) => ({ reglist: operand(o, 'reglist') & 0xff }),
    stack: (f) => 4 * (popcount(bits(f, 'reglist')) + 1),
  }),
  thumb('pop', {
    mask: 0xff00,
    match: 0xbc00,
    fields: [reglist('reglist', 0, 8)],
    syntax: 'pop {reglist}',
    toOperands: (f) => ({ reglist: bits(f, 'reglist') }),
    fromOperands: (o) => ({ reglist: operand(o, 'reglist') }),
    stack: (f) => 4 * popcount(bits(f, 'reglist')),
    registers: { reglist: 'reglist' },
    rejected: { reason: 'unpredictable', when: isEmptyList },
  }),
  thumb('stmia', {
    mask: 0xf800,
    match: 0xc000,
    fields: [reg('rn', 8), reglist('reglist', 0, 8)],
    syntax: 'stmia {rn}!, {reglist}',
    registers: { writes: ['rn'] },
    toOperands: (f) => ({ rn: bits(f, 'rn'), reglist: bits(f, 'reglist') }),
    fromOperands: (o) => ({ rn: operand(o, 'rn'), reglist: operand(o, 'reglist') }),
    // The base in the list stores an UNKNOWN value unless it is the lowest register.
    raw: (f) => {
      const list = bits(f, 'reglist');
      const base = 1 << bits(f, 'rn');
      if (list === 0) {
        return 'unpredictable';
      }
      return (list & base) !== 0 && (list & (base - 1)) !== 0 ? 'unpredictable' : null;
    },
  }),
  thumb('ldmia', {
    mask: 0xf800,
    match: 0xc800,
    fields: [reg('rn', 8), reglist('reglist', 0, 8)],
    // Writeback happens only when the base is not loaded, and the text says which.
    syntax: 'ldmia {rn}{wb}, {reglist}',
    registers: { writes: ['rn'], reglist: 'reglist' },
    toOperands: (f) => ({
      rn: bits(f, 'rn'),
      reglist: bits(f, 'reglist'),
      w: (bits(f, 'reglist') >> bits(f, 'rn')) & 1 ? 0 : 1,
    }),
    // as assembles `ldmia rn, {rn}` as `ldr rn, [rn]`, so that encoding has no text.
    fromOperands: (o) =>
      operand(o, 'reglist') === 1 << operand(o, 'rn')
        ? undefined
        : { rn: operand(o, 'rn'), reglist: operand(o, 'reglist') },
    raw: (f) => (bits(f, 'reglist') === 1 << bits(f, 'rn') ? 'as-alias' : emptyList(f)),
  }),
];

// ---------------------------------------------------------------------------------------------------
// Branches, swi and the undefined spaces.

const branches: Row[] = [
  thumb('b_cond_undefined', {
    mask: 0xff00,
    match: 0xde00,
    fields: [imm('imm', 0, 8)],
    syntax: 'undefined',
    rawOnly: 'undefined',
  }),
  thumb('swi', {
    mask: 0xff00,
    match: 0xdf00,
    fields: [imm('imm', 0, 8)],
    syntax: 'swi {imm}',
    flow: 'swi',
  }),
  thumb('bcc', {
    mask: 0xf000,
    match: 0xd000,
    fields: [cond(8), pcRel('imm', 0, 8, 2)],
    syntax: 'b{c} {target}',
    flow: 'cond-branch',
    toOperands: (f, a) => ({ cond: bits(f, 'cond'), target: branchTarget(pcOf(a, 'thumb'), bits(f, 'imm'), 8, 2) }),
    fromOperands: (o, a) => {
      const offset = branchOffset(pcOf(a, 'thumb'), operand(o, 'target'), 8, 2);
      const c = o.cond ?? COND_AL;
      return offset === undefined || c >= COND_AL ? undefined : { cond: c, imm: offset };
    },
  }),
  thumb('b', {
    mask: 0xf800,
    match: 0xe000,
    fields: [pcRel('imm', 0, 11, 2)],
    syntax: 'b {target}',
    flow: 'branch',
    toOperands: (f, a) => ({ target: branchTarget(pcOf(a, 'thumb'), bits(f, 'imm'), 11, 2) }),
    fromOperands: (o, a) => {
      const offset = branchOffset(pcOf(a, 'thumb'), operand(o, 'target'), 11, 2);
      return offset === undefined ? undefined : { imm: offset };
    },
  }),
  // Each half of a bl is an instruction of its own: the first sets lr, the second jumps through it. GNU as has
  // no text for one alone, so it prints raw.
  thumb('bl_prefix', {
    mask: 0xf800,
    match: 0xf000,
    fields: [blOff('hi', 0)],
    syntax: 'bl prefix',
    rawOnly: 'bl-half',
    flow: 'bl-prefix',
    registers: WRITES_LR,
  }),
  thumb('bl_suffix', {
    mask: 0xf800,
    match: 0xf800,
    fields: [blOff('lo', 0)],
    syntax: 'bl suffix',
    rawOnly: 'bl-half',
    flow: 'bl-suffix',
    registers: WRITES_LR,
  }),
  thumb('undefined', { mask: 0, match: 0, syntax: 'undefined', rawOnly: 'undefined' }),
];

/** The 32-bit bl pair: the prefix in the low halfword, the suffix in the high one. */
export const THUMB_BL: Row = thumb('bl', {
  mask: 0xf800_f800,
  match: 0xf800_f000,
  size: 4,
  fields: [blOff('hi', 0), blOff('lo', 16)],
  syntax: 'bl {target}',
  flow: 'bl',
  registers: WRITES_LR,
  toOperands: (f, a) => ({ target: branchTarget(pcOf(a, 'thumb'), (bits(f, 'hi') << 11) | bits(f, 'lo'), 22, 2) }),
  fromOperands: (o, a) => {
    const offset = branchOffset(pcOf(a, 'thumb'), operand(o, 'target'), 22, 2);
    return offset === undefined ? undefined : { hi: offset >>> 11, lo: offset & 0x7ff };
  },
});

/** Every 16-bit Thumb row in decode order; the last one matches everything. */
export const THUMB_ROWS: readonly Row[] = [
  ...shifts,
  ...addSub,
  ...aluRows,
  ...hi,
  ...pcLoads,
  ...regOffset,
  ...immOffset,
  ...spRelative,
  ...stack,
  ...branches,
];

// The ARM (ARMv4T) memory rows: word and byte loads and stores (with the user-mode T forms and the
// pc-relative pool load), halfword and signed transfers, the block transfers and swp. Loads into pc
// get rows of their own (flow class load-pc), so the flow class is a table fact.
import { popcount, wrap32 } from '../bits.js';
import { PC, SP } from '../names.js';
import type { Fields, OperandName, Operands, RawReason, RegisterSpec } from '../types.js';
import { bits, operand } from './access.js';
import { shiftFields, shiftOperands } from './arm-shift.js';
import { pcOf } from './pc-relative.js';
import { type Row, cond, flag, imm, reg, reglist, row, shiftType } from './row.js';

/** Whether an addressing mode writes its base back: post-indexed, or pre-indexed with `!`. */
const writesBack = (o: Operands): boolean => o.p === 0 || o.w === 1;

// ---------------------------------------------------------------------------------------------------
// Word and byte transfers: cond 01 I P U B W L Rn Rd offset.

interface Transfer {
  readonly name: string;
  readonly load: boolean;
  readonly byte: boolean;
  /** The user-mode forms ldrt/strt: post-indexed with W = 1. */
  readonly user: boolean;
}

const TRANSFERS: readonly Transfer[] = [false, true].flatMap((user) =>
  [false, true].flatMap((byte) =>
    [false, true].map((load) => ({
      name: `${load ? 'ldr' : 'str'}${byte ? 'b' : ''}${user ? 't' : ''}`,
      load,
      byte,
      user,
    })),
  ),
);

/** Writeback, the base and the index registers: what ARMv4T leaves UNPREDICTABLE. */
function transferRaw(t: Transfer, regOffset: boolean) {
  return (f: Fields): RawReason | null => {
    const writeback = t.user || bits(f, 'p') === 0 || bits(f, 'w') === 1;
    const rn = bits(f, 'rn');
    if (writeback && (rn === PC || rn === bits(f, 'rd'))) {
      return 'unpredictable';
    }
    if (regOffset && (bits(f, 'rm') === PC || (writeback && bits(f, 'rm') === rn))) {
      return 'unpredictable';
    }
    // A byte transfer of pc, and ldrt/strt of pc, are UNPREDICTABLE (as: "r15 not allowed here").
    if (bits(f, 'rd') === PC && (t.byte || t.user)) {
      return 'unpredictable';
    }
    return null;
  };
}

/**
 * A load writes rd, and a word load is followed to its address registers; a transfer that writes its base back
 * (always, for the user-mode forms) writes rn too.
 */
function transferRegisters(t: Transfer, regOffset: boolean, o: Operands): RegisterSpec {
  const writes: OperandName[] = [
    ...(t.load ? (['rd'] as const) : []),
    ...(t.user || writesBack(o) ? (['rn'] as const) : []),
  ];
  const address: readonly OperandName[] = regOffset ? ['rn', 'rm'] : ['rn'];
  return t.load && !t.byte ? { writes, from: address } : { writes };
}

function transferRow(t: Transfer, regOffset: boolean, pcDest: boolean): Row {
  const lb = (t.byte ? 1 << 22 : 0) | (t.load ? 1 << 20 : 0);
  // The T forms fix P = 0 and W = 1; the others exclude that pair by coming after them.
  const mask = (t.user ? 0x0f70_0000 : 0x0e50_0000) | (regOffset ? 0x10 : 0) | (pcDest ? 0xf000 : 0);
  const match = (regOffset ? 0x0600_0000 : 0x0400_0000) | lb | (t.user ? 0x0020_0000 : 0) | (pcDest ? 0xf000 : 0);
  const indexFields = t.user ? [] : [flag('p', 24), flag('w', 21)];
  const offsetFields = regOffset ? [imm('samt', 7, 5), shiftType('stype', 5), reg('rm', 0, 4)] : [imm('imm', 0, 12)];
  const fields = [cond(), ...indexFields, flag('u', 23), reg('rn', 16, 4), reg('rd', 12, 4), ...offsetFields];
  return row(`arm.${t.name}_${regOffset ? 'reg' : 'imm'}${pcDest ? '_pc' : ''}`, 'arm', {
    mask,
    match,
    fields,
    syntax: `${t.name}{c} {rd}, ${regOffset ? '{amode_reg}' : '{amode}'}`,
    flow: pcDest ? 'load-pc' : 'next',
    registers: (o) => transferRegisters(t, regOffset, o),
    toOperands: (f) => ({
      cond: bits(f, 'cond'),
      rd: bits(f, 'rd'),
      rn: bits(f, 'rn'),
      u: bits(f, 'u'),
      p: t.user ? 0 : bits(f, 'p'),
      w: t.user ? 0 : bits(f, 'w'),
      ...(regOffset
        ? { rm: bits(f, 'rm'), ...shiftOperands(bits(f, 'stype'), bits(f, 'samt')) }
        : { imm: bits(f, 'imm') }),
    }),
    fromOperands: (o) => {
      const base = {
        cond: operand(o, 'cond'),
        rd: operand(o, 'rd'),
        rn: operand(o, 'rn'),
        u: operand(o, 'u'),
        ...(t.user ? {} : { p: operand(o, 'p'), w: operand(o, 'w') }),
      };
      // as refuses `ldr/str pc, [pc, #imm]` unless imm is a multiple of 4 ("ldr to register 15 must
      // be 4-byte aligned"); the label form of ldr has no such check and is the pool row's.
      if (!regOffset) {
        return o.rd === PC && o.rn === PC && operand(o, 'imm') % 4 !== 0
          ? undefined
          : { ...base, imm: operand(o, 'imm') };
      }
      const shift = shiftFields(operand(o, 'shift'), operand(o, 'amount'));
      return shift === undefined ? undefined : { ...base, rm: operand(o, 'rm'), ...shift };
    },
    raw: transferRaw(t, regOffset),
    // as: "r15 not allowed here" for a byte transfer of pc and for ldrt/ldrbt/strbt of pc (strt pc is accepted).
    rejected: { reason: 'unpredictable', when: (f) => bits(f, 'rd') === PC && (t.byte || (t.user && t.load)) },
    stack: (f) => {
      const writeback = t.user || bits(f, 'p') === 0 || bits(f, 'w') === 1;
      if (regOffset || !writeback || bits(f, 'rn') !== SP) {
        return 0;
      }
      return (bits(f, 'u') === 1 ? 1 : -1) * bits(f, 'imm');
    },
  });
}

/** `ldr rd, label`: the pc-relative word load (P = 1, W = 0, Rn = pc). */
const LDR_POOL: Row = row('arm.ldr_pc', 'arm', {
  mask: 0x0f7f_0000,
  match: 0x051f_0000,
  fields: [cond(), flag('u', 23), reg('rd', 12, 4), imm('imm', 0, 12)],
  syntax: 'ldr{c} {rd}, {target}',
  flow: 'pool-load',
  registers: { writes: ['rd'] },
  toOperands: (f, a) => ({
    cond: bits(f, 'cond'),
    rd: bits(f, 'rd'),
    target: wrap32(pcOf(a, 'arm') + (bits(f, 'u') === 1 ? 1 : -1) * bits(f, 'imm')),
  }),
  fromOperands: (o, a) => {
    const offset = operand(o, 'target') - pcOf(a, 'arm');
    return { cond: operand(o, 'cond'), rd: operand(o, 'rd'), u: offset < 0 ? 0 : 1, imm: Math.abs(offset) };
  },
  // A label at pc + 8 assembles with U = 1, so `[pc, #-0]` has no label form.
  raw: (f) => (bits(f, 'u') === 0 && bits(f, 'imm') === 0 ? 'as-alias' : null),
});

const userTransfers = TRANSFERS.filter((t) => t.user);
const plainTransfers = TRANSFERS.filter((t) => !t.user);

const singleTransfers: Row[] = [
  LDR_POOL,
  ...userTransfers.flatMap((t) =>
    [false, true].flatMap((r) =>
      t.load ? [transferRow(t, r, true), transferRow(t, r, false)] : [transferRow(t, r, false)],
    ),
  ),
  ...plainTransfers.flatMap((t) =>
    [false, true].flatMap((r) =>
      t.load ? [transferRow(t, r, true), transferRow(t, r, false)] : [transferRow(t, r, false)],
    ),
  ),
];

// ---------------------------------------------------------------------------------------------------
// Halfword and signed transfers: cond 000 P U I W L Rn Rd hi 1 S H 1 lo.

const HALF: readonly (readonly [string, number, number, number])[] = [
  ['strh', 0, 0, 1],
  ['ldrh', 1, 0, 1],
  ['ldrsb', 1, 1, 0],
  ['ldrsh', 1, 1, 1],
];

function halfRow(name: string, l: number, s: number, h: number, regOffset: boolean): Row {
  const offsetFields = regOffset ? [imm('sbz', 8, 4), reg('rm', 0, 4)] : [imm('immh', 8, 4), imm('imml', 0, 4)];
  return row(`arm.${name}_${regOffset ? 'reg' : 'imm'}`, 'arm', {
    mask: 0x0e50_00f0,
    match: (regOffset ? 0 : 1 << 22) | (l << 20) | 0x90 | (s << 6) | (h << 5),
    fields: [cond(), flag('p', 24), flag('u', 23), flag('w', 21), reg('rn', 16, 4), reg('rd', 12, 4), ...offsetFields],
    syntax: `${name}{c} {rd}, ${regOffset ? '{hamode_reg}' : '{amode}'}`,
    registers: (o) => ({
      writes: [...(l === 1 ? (['rd'] as const) : []), ...(writesBack(o) ? (['rn'] as const) : [])],
    }),
    toOperands: (f) => ({
      cond: bits(f, 'cond'),
      rd: bits(f, 'rd'),
      rn: bits(f, 'rn'),
      p: bits(f, 'p'),
      u: bits(f, 'u'),
      w: bits(f, 'w'),
      ...(regOffset ? { rm: bits(f, 'rm') } : { imm: (bits(f, 'immh') << 4) | bits(f, 'imml') }),
    }),
    fromOperands: (o) => {
      const base = {
        cond: operand(o, 'cond'),
        rd: operand(o, 'rd'),
        rn: operand(o, 'rn'),
        p: operand(o, 'p'),
        u: operand(o, 'u'),
        w: operand(o, 'w'),
      };
      if (regOffset) {
        return { ...base, sbz: 0, rm: operand(o, 'rm') };
      }
      const value = operand(o, 'imm');
      return value > 0xff ? undefined : { ...base, immh: value >> 4, imml: value & 15 };
    },
    raw: (f) => {
      if (regOffset && bits(f, 'sbz') !== 0) {
        return 'sbz-set';
      }
      if (bits(f, 'p') === 0 && bits(f, 'w') === 1) {
        return 'unpredictable';
      }
      const writeback = bits(f, 'p') === 0 || bits(f, 'w') === 1;
      if (writeback && (bits(f, 'rn') === PC || bits(f, 'rn') === bits(f, 'rd'))) {
        return 'unpredictable';
      }
      if (regOffset && bits(f, 'rm') === PC) {
        return 'unpredictable';
      }
      return null;
    },
    // A halfword or signed transfer of pc is UNPREDICTABLE, and as refuses it.
    rejected: { reason: 'unpredictable', when: (f) => bits(f, 'rd') === PC },
  });
}

const halfTransfers: Row[] = [
  // L = 0 with S = 1 is ldrd/strd from ARMv5TE: undefined on the ARMv4T.
  row('arm.ldrd_strd', 'arm', {
    mask: 0x0e10_00d0,
    match: 0x0000_00d0,
    fields: [cond()],
    syntax: 'ldrd/strd',
    rawOnly: 'undefined',
  }),
  ...HALF.flatMap(([name, l, s, h]) => [halfRow(name, l, s, h, false), halfRow(name, l, s, h, true)]),
];

// ---------------------------------------------------------------------------------------------------
// Block transfers: cond 100 P U S W L Rn list.

function blockRow(name: 'ldm' | 'stm', loadsPc: boolean): Row {
  const load = name === 'ldm';
  return row(`arm.${name}${loadsPc ? '_pc' : ''}`, 'arm', {
    mask: loadsPc ? 0x0e10_8000 : 0x0e10_0000,
    match: (load ? 0x0810_0000 : 0x0800_0000) | (loadsPc ? 0x8000 : 0),
    fields: [
      cond(),
      flag('p', 24),
      flag('u', 23),
      flag('user', 22),
      flag('w', 21),
      reg('rn', 16, 4),
      reglist('list', 0, 16),
    ],
    syntax: `${name}{am}{c} {rn}{wb}, {list}{caret}`,
    flow: loadsPc ? 'load-pc' : 'next',
    registers: (o) => ({ ...(load ? { list: 'list' as const } : {}), writes: o.w === 1 ? ['rn'] : [] }),
    raw: (f) => {
      const list = bits(f, 'list');
      const rn = bits(f, 'rn');
      const base = 1 << rn;
      const w = bits(f, 'w') === 1;
      if (list === 0 || rn === PC) {
        return 'unpredictable';
      }
      if (w && (list & base) !== 0 && (load || (list & (base - 1)) !== 0)) {
        return 'unpredictable';
      }
      // ^ without pc in a load means the user-bank registers, which forbids writeback.
      if (bits(f, 'user') === 1 && w && !loadsPc) {
        return 'unpredictable';
      }
      return null;
    },
    stack: (f) =>
      bits(f, 'rn') === SP && bits(f, 'w') === 1 ? (bits(f, 'u') === 1 ? 4 : -4) * popcount(bits(f, 'list')) : 0,
  });
}

const blockTransfers: Row[] = [blockRow('ldm', true), blockRow('ldm', false), blockRow('stm', false)];

// ---------------------------------------------------------------------------------------------------
// swp and swpb.

function swpRow(byte: boolean): Row {
  const name = byte ? 'swpb' : 'swp';
  return row(`arm.${name}`, 'arm', {
    mask: 0x0ff0_00f0,
    match: byte ? 0x0140_0090 : 0x0100_0090,
    fields: [cond(), reg('rn', 16, 4), reg('rd', 12, 4), imm('sbz', 8, 4), reg('rm', 0, 4)],
    syntax: `${name}{c} {rd}, {rm}, [{rn}]`,
    registers: { writes: ['rd'] },
    fromOperands: (o) => ({
      cond: operand(o, 'cond'),
      rn: operand(o, 'rn'),
      rd: operand(o, 'rd'),
      sbz: 0,
      rm: operand(o, 'rm'),
    }),
    raw: (f) => {
      if (bits(f, 'sbz') !== 0) {
        return 'sbz-set';
      }
      return [bits(f, 'rn'), bits(f, 'rd'), bits(f, 'rm')].includes(PC) ? 'unpredictable' : null;
    },
    // as: "Rn must not overlap other operands".
    rejected: {
      reason: 'unpredictable',
      when: (f) => bits(f, 'rn') === bits(f, 'rd') || bits(f, 'rn') === bits(f, 'rm'),
    },
  });
}

const swaps: Row[] = [
  swpRow(false),
  swpRow(true),
  // The rest of 0001 xxxx 1001 (ldrex and friends in later architectures).
  row('arm.swp_undefined', 'arm', {
    mask: 0x0f00_00f0,
    match: 0x0100_0090,
    fields: [cond()],
    syntax: 'undefined',
    rawOnly: 'undefined',
  }),
];

/** The memory rows in decode order. */
export const ARM_MEMORY_ROWS = { singleTransfers, halfTransfers, blockTransfers, swaps } as const;

// The ARM (ARMv4T) memory rows: word and byte loads and stores (with the user-mode T forms and the
// pc-relative pool load), halfword and signed transfers, the block transfers and swp. Loads into pc
// get rows of their own (flow pop-pc), so the flow class is a table fact.
import { popcount, fieldValue as v, wrap32 } from '../bits.js';
import type { Fields, RawReason } from '../types.js';
import { shiftFields, shiftOperands } from './arm-shift.js';
import { pcOf } from './pc-relative.js';
import { cond, flag, imm, reg, reglist, row, shiftType } from './row.js';
import type { Row } from './row.js';

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
    const writeback = t.user || v(f, 'p') === 0 || v(f, 'w') === 1;
    const rn = v(f, 'rn');
    if (writeback && (rn === 15 || rn === v(f, 'rd'))) {
      return 'unpredictable';
    }
    if (regOffset && (v(f, 'rm') === 15 || (writeback && v(f, 'rm') === rn))) {
      return 'unpredictable';
    }
    // A byte transfer of pc, and ldrt/strt of pc, are UNPREDICTABLE (as: "r15 not allowed here").
    if (v(f, 'rd') === 15 && (t.byte || t.user)) {
      return 'unpredictable';
    }
    return null;
  };
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
    flow: pcDest ? 'pop-pc' : 'next',
    toOps: (f) => ({
      cond: v(f, 'cond'),
      rd: v(f, 'rd'),
      rn: v(f, 'rn'),
      u: v(f, 'u'),
      p: t.user ? 0 : v(f, 'p'),
      w: t.user ? 0 : v(f, 'w'),
      ...(regOffset ? { rm: v(f, 'rm'), ...shiftOperands(v(f, 'stype'), v(f, 'samt')) } : { imm: v(f, 'imm') }),
    }),
    fromOps: (o) => {
      const base = {
        cond: v(o, 'cond'),
        rd: v(o, 'rd'),
        rn: v(o, 'rn'),
        u: v(o, 'u'),
        ...(t.user ? {} : { p: v(o, 'p'), w: v(o, 'w') }),
      };
      // as refuses `ldr/str pc, [pc, #imm]` unless imm is a multiple of 4 ("ldr to register 15 must
      // be 4-byte aligned"); the label form of ldr has no such check and is the pool row's.
      if (!regOffset) {
        return v(o, 'rd') === 15 && v(o, 'rn') === 15 && v(o, 'imm') % 4 !== 0
          ? undefined
          : { ...base, imm: v(o, 'imm') };
      }
      const shift = shiftFields(v(o, 'shift'), v(o, 'amount'));
      return shift === undefined ? undefined : { ...base, rm: v(o, 'rm'), ...shift };
    },
    raw: transferRaw(t, regOffset),
    // as: "r15 not allowed here" for a byte transfer of pc and for ldrt/ldrbt/strbt of pc (strt pc is accepted).
    refuse: (f) => v(f, 'rd') === 15 && (t.byte || (t.user && t.load)),
    stack: (f) => {
      const writeback = t.user || v(f, 'p') === 0 || v(f, 'w') === 1;
      if (regOffset || !writeback || v(f, 'rn') !== 13) {
        return 0;
      }
      return (v(f, 'u') === 1 ? 1 : -1) * v(f, 'imm');
    },
  });
}

/** `ldr rd, label`: the pc-relative word load (P = 1, W = 0, Rn = pc). */
const LDR_POOL: Row = row('arm.ldr_pc', 'arm', {
  mask: 0x0f7f_0000,
  match: 0x051f_0000,
  fields: [cond(), flag('u', 23), reg('rd', 12, 4), imm('imm', 0, 12)],
  syntax: 'ldr{c} {rd}, {target}',
  flow: 'pc-load',
  toOps: (f, a) => ({
    cond: v(f, 'cond'),
    rd: v(f, 'rd'),
    target: wrap32(pcOf(a, 'arm') + (v(f, 'u') === 1 ? 1 : -1) * v(f, 'imm')),
  }),
  fromOps: (o, a) => {
    const offset = v(o, 'target') - pcOf(a, 'arm');
    return { cond: v(o, 'cond'), rd: v(o, 'rd'), u: offset < 0 ? 0 : 1, imm: Math.abs(offset) };
  },
  // A label at pc + 8 assembles with U = 1, so `[pc, #-0]` has no label form.
  raw: (f) => (v(f, 'u') === 0 && v(f, 'imm') === 0 ? 'as-alias' : null),
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
    toOps: (f) => ({
      cond: v(f, 'cond'),
      rd: v(f, 'rd'),
      rn: v(f, 'rn'),
      p: v(f, 'p'),
      u: v(f, 'u'),
      w: v(f, 'w'),
      ...(regOffset ? { rm: v(f, 'rm') } : { imm: (v(f, 'immh') << 4) | v(f, 'imml') }),
    }),
    fromOps: (o) => {
      const base = { cond: v(o, 'cond'), rd: v(o, 'rd'), rn: v(o, 'rn'), p: v(o, 'p'), u: v(o, 'u'), w: v(o, 'w') };
      if (regOffset) {
        return { ...base, sbz: 0, rm: v(o, 'rm') };
      }
      const value = v(o, 'imm');
      return value > 0xff ? undefined : { ...base, immh: value >> 4, imml: value & 15 };
    },
    refuse: (f) => v(f, 'rd') === 15,
    raw: (f) => {
      if (regOffset && v(f, 'sbz') !== 0) {
        return 'sbz-set';
      }
      if (v(f, 'p') === 0 && v(f, 'w') === 1) {
        return 'unpredictable';
      }
      const writeback = v(f, 'p') === 0 || v(f, 'w') === 1;
      if (v(f, 'rd') === 15) {
        return 'unpredictable';
      }
      if (writeback && (v(f, 'rn') === 15 || v(f, 'rn') === v(f, 'rd'))) {
        return 'unpredictable';
      }
      if (regOffset && v(f, 'rm') === 15) {
        return 'unpredictable';
      }
      return null;
    },
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
    flow: loadsPc ? 'pop-pc' : 'next',
    raw: (f) => {
      const list = v(f, 'list');
      const rn = v(f, 'rn');
      const base = 1 << rn;
      const w = v(f, 'w') === 1;
      if (list === 0 || rn === 15) {
        return 'unpredictable';
      }
      if (w && (list & base) !== 0 && (load || (list & (base - 1)) !== 0)) {
        return 'unpredictable';
      }
      // ^ without pc in a load means the user-bank registers, which forbids writeback.
      if (v(f, 'user') === 1 && w && !loadsPc) {
        return 'unpredictable';
      }
      return null;
    },
    stack: (f) => (v(f, 'rn') === 13 && v(f, 'w') === 1 ? (v(f, 'u') === 1 ? 4 : -4) * popcount(v(f, 'list')) : 0),
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
    fromOps: (o) => ({ cond: v(o, 'cond'), rn: v(o, 'rn'), rd: v(o, 'rd'), sbz: 0, rm: v(o, 'rm') }),
    // as: "Rn must not overlap other operands".
    refuse: (f) => v(f, 'rn') === v(f, 'rd') || v(f, 'rn') === v(f, 'rm'),
    raw: (f) => {
      if (v(f, 'sbz') !== 0) {
        return 'sbz-set';
      }
      const rn = v(f, 'rn');
      if ([rn, v(f, 'rd'), v(f, 'rm')].includes(15) || rn === v(f, 'rd') || rn === v(f, 'rm')) {
        return 'unpredictable';
      }
      return null;
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

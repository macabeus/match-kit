// The remaining ARM (ARMv4T) rows: the never condition, branches, swi, multiplies, bx, the status
// register moves, and the coprocessor and undefined spaces (the tables describe a core with no
// coprocessor, such as the ARM7TDMI, where every coprocessor instruction traps as undefined).
import { LR, PC } from '../names.js';
import type { Operands } from '../types.js';
import { bits, operand } from './access.js';
import { constField, constOperands } from './arm-immediate.js';
import { branchOffset, branchTarget, pcOf } from './pc-relative.js';
import { type Row, cond, flag, imm, pcRel, reg, rotImm, row } from './row.js';

/** Condition 0b1111 is UNPREDICTABLE on the ARMv4T (ARMv5 reuses it for unconditional forms). */
export const ARM_NV: Row = row('arm.nv', 'arm', {
  mask: 0xf000_0000,
  match: 0xf000_0000,
  syntax: 'condition nv',
  rawOnly: 'unpredictable',
});

function branchRow(link: boolean): Row {
  return row(link ? 'arm.bl' : 'arm.b', 'arm', {
    mask: 0x0f00_0000,
    match: link ? 0x0b00_0000 : 0x0a00_0000,
    fields: [cond(), pcRel('off', 0, 24, 4)],
    syntax: `${link ? 'bl' : 'b'}{c} {target}`,
    flow: link ? 'bl' : 'branch',
    // What the callee does to other registers is a calling convention's, not the instruction's.
    ...(link ? { registers: { fixed: 1 << LR } } : {}),
    toOperands: (f, a) => ({ cond: bits(f, 'cond'), target: branchTarget(pcOf(a, 'arm'), bits(f, 'off'), 24, 4) }),
    fromOperands: (o, a) => {
      const off = branchOffset(pcOf(a, 'arm'), operand(o, 'target'), 24, 4);
      return off === undefined ? undefined : { cond: operand(o, 'cond'), off };
    },
  });
}

export const ARM_CONTROL_ROWS: readonly Row[] = [
  branchRow(false),
  branchRow(true),
  row('arm.swi', 'arm', {
    mask: 0x0f00_0000,
    match: 0x0f00_0000,
    fields: [cond(), imm('imm', 0, 24)],
    syntax: 'swi{c} {imm}',
    flow: 'swi',
  }),
  row('arm.coprocessor_transfer', 'arm', {
    mask: 0x0e00_0000,
    match: 0x0c00_0000,
    fields: [cond()],
    syntax: 'coprocessor',
    rawOnly: 'undefined',
  }),
  row('arm.coprocessor', 'arm', {
    mask: 0x0f00_0000,
    match: 0x0e00_0000,
    fields: [cond()],
    syntax: 'coprocessor',
    rawOnly: 'undefined',
  }),
];

/** cond 011 ... 1: the architecturally undefined space (media instructions in later architectures). */
export const ARM_MEDIA_UNDEFINED: Row = row('arm.media_undefined', 'arm', {
  mask: 0x0e00_0010,
  match: 0x0600_0010,
  fields: [cond()],
  syntax: 'undefined',
  rawOnly: 'undefined',
});

// ---------------------------------------------------------------------------------------------------
// Multiplies: cond 0000 xxxS ... 1001.

function mulRow(name: 'mul' | 'mla', accumulate: boolean): Row {
  return row(`arm.${name}`, 'arm', {
    mask: 0x0fe0_00f0,
    match: (accumulate ? 0x0020_0000 : 0) | 0x90,
    fields: [
      cond(),
      flag('s', 20),
      reg('rd', 16, 4),
      reg(accumulate ? 'rn' : 'sbz', 12, 4),
      reg('rs', 8, 4),
      reg('rm', 0, 4),
    ],
    syntax: accumulate ? 'mla{s}{c} {rd}, {rm}, {rs}, {rn}' : 'mul{s}{c} {rd}, {rm}, {rs}',
    registers: { writes: ['rd'] },
    ...(accumulate
      ? {}
      : {
          fromOperands: (o: Operands) => ({
            cond: operand(o, 'cond'),
            s: operand(o, 's'),
            rd: operand(o, 'rd'),
            sbz: 0,
            rs: operand(o, 'rs'),
            rm: operand(o, 'rm'),
          }),
        }),
    raw: (f) => {
      if (!accumulate && bits(f, 'sbz') !== 0) {
        return 'sbz-set';
      }
      const regs = [bits(f, 'rd'), bits(f, 'rs'), bits(f, 'rm'), ...(accumulate ? [bits(f, 'rn')] : [])];
      return regs.includes(PC) || bits(f, 'rd') === bits(f, 'rm') ? 'unpredictable' : null;
    },
  });
}

const LONG: readonly string[] = ['umull', 'umlal', 'smull', 'smlal'];

const longMulRows: Row[] = LONG.map((name, i) =>
  row(`arm.${name}`, 'arm', {
    mask: 0x0fe0_00f0,
    match: 0x0080_0000 | (i << 21) | 0x90,
    fields: [cond(), flag('s', 20), reg('rdhi', 16, 4), reg('rdlo', 12, 4), reg('rs', 8, 4), reg('rm', 0, 4)],
    syntax: `${name}{s}{c} {rdlo}, {rdhi}, {rm}, {rs}`,
    registers: { writes: ['rdlo', 'rdhi'] },
    raw: (f) => {
      const hi = bits(f, 'rdhi');
      const lo = bits(f, 'rdlo');
      const rm = bits(f, 'rm');
      return [hi, lo, rm, bits(f, 'rs')].includes(PC) || hi === lo || hi === rm || lo === rm ? 'unpredictable' : null;
    },
  }),
);

export const ARM_MULTIPLY_ROWS: readonly Row[] = [
  mulRow('mul', false),
  mulRow('mla', true),
  row('arm.mul_undefined', 'arm', {
    mask: 0x0fc0_00f0,
    match: 0x0040_0090,
    fields: [cond()],
    syntax: 'undefined',
    rawOnly: 'undefined',
  }),
  ...longMulRows,
];

// ---------------------------------------------------------------------------------------------------
// The miscellaneous space (opcodes tst..cmn with S = 0): bx, mrs, msr and undefined.

/** A status-register move whose should-be-one or should-be-zero bits are not: printed raw. */
const sbo = (id: string, mask: number, match: number, syntax: string): Row =>
  row(`arm.${id}`, 'arm', {
    mask,
    match,
    fields: [cond(), flag('r', 22), reg('rd', 12, 4), reg('rm', 0, 4)],
    syntax,
    rawOnly: 'sbz-set',
  });

export const ARM_MISC_ROWS: readonly Row[] = [
  row('arm.bx', 'arm', {
    mask: 0x0fff_fff0,
    match: 0x012f_ff10,
    fields: [cond(), reg('rm', 0, 4)],
    syntax: 'bx{c} {rm}',
    flow: 'bx',
  }),
  // bx with its should-be-one bits clear: not the canonical encoding, and the PoC does not treat it as bx.
  row('arm.bx_sbo', 'arm', {
    mask: 0x0ff0_00f0,
    match: 0x0120_0010,
    fields: [cond(), reg('rm', 0, 4)],
    syntax: 'bx{c} {rm}',
    rawOnly: 'sbz-set',
  }),
  row('arm.mrs', 'arm', {
    mask: 0x0fbf_0fff,
    match: 0x010f_0000,
    fields: [cond(), flag('r', 22), reg('rd', 12, 4)],
    syntax: 'mrs{c} {rd}, {psr}',
    registers: { writes: ['rd'] },
    rejected: { reason: 'unpredictable', when: (f) => bits(f, 'rd') === PC },
  }),
  sbo('mrs_sbo', 0x0fb0_00f0, 0x0100_0000, 'mrs{c} {rd}, {psr}'),
  row('arm.msr_reg', 'arm', {
    mask: 0x0fb0_fff0,
    match: 0x0120_f000,
    fields: [cond(), flag('r', 22), imm('mask', 16, 4), reg('rm', 0, 4)],
    syntax: 'msr{c} {psrf}, {rm}',
    raw: (f) => (bits(f, 'mask') === 0 || bits(f, 'rm') === PC ? 'unpredictable' : null),
  }),
  sbo('msr_reg_sbo', 0x0fb0_00f0, 0x0120_0000, 'msr{c} {psr}, {rm}'),
  row('arm.msr_imm', 'arm', {
    mask: 0x0fb0_f000,
    match: 0x0320_f000,
    fields: [cond(), flag('r', 22), imm('mask', 16, 4), rotImm('imm12')],
    syntax: 'msr{c} {psrf}, {const}',
    toOperands: (f) => ({
      cond: bits(f, 'cond'),
      r: bits(f, 'r'),
      mask: bits(f, 'mask'),
      ...constOperands(bits(f, 'imm12')),
    }),
    fromOperands: (o) => {
      const field = constField(o);
      return field === undefined
        ? undefined
        : { cond: operand(o, 'cond'), r: operand(o, 'r'), mask: operand(o, 'mask'), imm12: field };
    },
    raw: (f) => (bits(f, 'mask') === 0 ? 'unpredictable' : null),
    // as takes no explicit `#imm8, rot` for msr, so a non-canonical rotation has no text.
    rejected: { reason: 'as-alias', when: (f) => constOperands(bits(f, 'imm12')).explicit === 1 },
  }),
  row('arm.msr_imm_sbo', 'arm', {
    mask: 0x0fb0_0000,
    match: 0x0320_0000,
    fields: [cond()],
    syntax: 'msr{c} cpsr, #imm',
    rawOnly: 'sbz-set',
  }),
  // Everything else with opcode tst..cmn and S = 0.
  row('arm.misc_undefined', 'arm', {
    mask: 0x0d90_0000,
    match: 0x0100_0000,
    fields: [cond()],
    syntax: 'undefined',
    rawOnly: 'undefined',
  }),
];

/** The catch-all last row: decode never fails. */
export const ARM_UNDEFINED: Row = row('arm.undefined', 'arm', {
  mask: 0,
  match: 0,
  syntax: 'undefined',
  rawOnly: 'undefined',
});

// The ARM (ARMv4T) data-processing rows: 16 opcodes in three operand forms (rotated immediate,
// register shifted by an immediate, register shifted by a register). Writes to pc get rows of their
// own so the flow class is a table fact: `add pc, ...` is add-pc and every other data-processing
// write to pc is mov-pc. `add`/`sub` from pc with a rotated immediate print as `adr`.
import { fieldValue as v, wrap32 } from '../bits.js';
import type { Fields, FlowKind, RawReason } from '../types.js';
import {
  constField,
  constOperands,
  decodeArmImmediate,
  encodeArmImmediate,
  isCanonicalArmImmediate,
} from './arm-immediate.js';
import { shiftFields, shiftOperands } from './arm-shift.js';
import { pcOf } from './pc-relative.js';
import { cond, flag, imm, reg, rotImm, row, shiftType } from './row.js';
import type { FromOperands, Row, RowOptions, ToOperands } from './row.js';

const OPCODES: readonly string[] = [
  'and',
  'eor',
  'sub',
  'rsb',
  'add',
  'adc',
  'sbc',
  'rsc',
  'tst',
  'teq',
  'cmp',
  'cmn',
  'orr',
  'mov',
  'bic',
  'mvn',
];

type Form = 'imm' | 'ims' | 'rs';

const FORM_MASK: Readonly<Record<Form, number>> = { imm: 0x0fe0_0000, ims: 0x0fe0_0010, rs: 0x0fe0_0090 };
const FORM_MATCH: Readonly<Record<Form, number>> = { imm: 0x0200_0000, ims: 0, rs: 0x10 };

/** The second-operand text, fields and codec of each form. */
const OPERAND2: Readonly<
  Record<
    Form,
    {
      readonly text: string;
      readonly fields: RowOptions['fields'];
      to: (f: Fields) => Fields;
      from: (o: Fields) => Fields | undefined;
    }
  >
> = {
  imm: {
    text: '{const}',
    fields: [rotImm('imm12')],
    to: (f) => constOperands(v(f, 'imm12')),
    from: (o) => {
      const field = constField(o);
      return field === undefined ? undefined : { imm12: field };
    },
  },
  ims: {
    text: '{rm}{shift}',
    fields: [imm('samt', 7, 5), shiftType('stype', 5), reg('rm', 0, 4)],
    to: (f) => ({ rm: v(f, 'rm'), ...shiftOperands(v(f, 'stype'), v(f, 'samt')) }),
    from: (o) => {
      const shift = shiftFields(v(o, 'shift'), v(o, 'amount'));
      return shift === undefined ? undefined : { rm: v(o, 'rm'), ...shift };
    },
  },
  rs: {
    text: '{rm}{rshift}',
    fields: [reg('rs', 8, 4), shiftType('stype', 5), reg('rm', 0, 4)],
    to: (f) => ({ rm: v(f, 'rm'), rs: v(f, 'rs'), shift: v(f, 'stype') }),
    from: (o) => (v(o, 'shift') > 3 ? undefined : { rm: v(o, 'rm'), rs: v(o, 'rs'), stype: v(o, 'shift') }),
  },
};

interface Shape {
  readonly test: boolean;
  readonly move: boolean;
}

function shapeOf(op: number): Shape {
  return { test: op >= 8 && op <= 11, move: op === 13 || op === 15 };
}

function dpRow(op: number, form: Form, pcDest: boolean): Row {
  const name = OPCODES[op] ?? 'dp';
  const { test, move } = shapeOf(op);
  const operand2 = OPERAND2[form];
  const head = test ? `${name}{c}` : `${name}{s}{c}`;
  const first = test ? '{rn}' : move ? '{rd}' : '{rd}, {rn}';
  const fields = [
    cond(),
    ...(test ? [] : [flag('s', 20)]),
    reg('rn', 16, 4),
    reg('rd', 12, 4),
    ...(operand2.fields ?? []),
  ];

  const toOps: ToOperands = (f) => ({
    cond: v(f, 'cond'),
    ...(test ? {} : { s: v(f, 's'), rd: v(f, 'rd') }),
    ...(move ? {} : { rn: v(f, 'rn') }),
    ...operand2.to(f),
  });
  const fromOps: FromOperands = (o) => {
    // as turns `add rd, pc, #v` (no s, no explicit rotation) into a pc-relative fixup: a v of 2^31 or
    // more becomes a sub of its negation, or an error, so only smaller values keep this encoding.
    const pcRelative = op === 4 && form === 'imm' && o['rn'] === 15 && o['s'] !== 1 && o['explicit'] !== 1;
    if (pcRelative && v(o, 'imm') >= 2 ** 31) {
      return undefined;
    }
    const second = operand2.from(o);
    if (second === undefined) {
      return undefined;
    }
    return {
      cond: v(o, 'cond'),
      ...(test ? {} : { s: v(o, 's') }),
      rd: test ? 0 : v(o, 'rd'),
      rn: move ? 0 : v(o, 'rn'),
      ...second,
    };
  };

  const raw = (f: Fields): RawReason | null => {
    if (test && v(f, 'rd') !== 0) {
      return 'sbz-set';
    }
    if (move && v(f, 'rn') !== 0) {
      return 'sbz-set';
    }
    if (form === 'rs') {
      const regs = [v(f, 'rm'), v(f, 'rs'), ...(test ? [] : [v(f, 'rd')]), ...(move ? [] : [v(f, 'rn')])];
      if (regs.includes(15)) {
        return 'unpredictable';
      }
    }
    return null;
  };

  const flow: FlowKind = pcDest ? (op === 4 ? 'add-pc' : 'mov-pc') : 'next';
  const sMask = test ? 1 << 20 : 0;
  const stack =
    form === 'imm' && (op === 2 || op === 4) && !pcDest
      ? (f: Fields): number =>
          v(f, 'rd') === 13 && v(f, 'rn') === 13 ? (op === 4 ? 1 : -1) * decodeArmImmediate(v(f, 'imm12')) : 0
      : undefined;
  return row(`arm.${name}_${form}${pcDest ? '_pc' : ''}`, 'arm', {
    mask: FORM_MASK[form] | sMask | (pcDest ? 0xf000 : 0),
    match: FORM_MATCH[form] | (op << 21) | sMask | (pcDest ? 0xf000 : 0),
    fields,
    syntax: `${head} ${first}, ${operand2.text}`,
    flow,
    toOps,
    fromOps,
    raw,
    ...(stack === undefined ? {} : { stack }),
  });
}

/** `adr rd, label`: add or sub rd, pc, #imm, as GNU as picks for the label's offset. */
function adrRow(subtract: boolean): Row {
  const fields = [cond(), reg('rd', 12, 4), rotImm('imm12')];
  return row(subtract ? 'arm.adr_sub' : 'arm.adr_add', 'arm', {
    mask: 0x0fff_0000,
    match: subtract ? 0x024f_0000 : 0x028f_0000,
    fields,
    syntax: 'adr{c} {rd}, {target}',
    flow: 'adr',
    asPriority: subtract ? 1 : 0,
    toOps: (f, a) => {
      const value = decodeArmImmediate(v(f, 'imm12'));
      return { cond: v(f, 'cond'), rd: v(f, 'rd'), target: wrap32(pcOf(a, 'arm') + (subtract ? -value : value)) };
    },
    fromOps: (o, a) => {
      // as resolves the label to a signed offset: add #off when it is non-negative and encodable, else
      // sub #-off (taken modulo 2^32); an offset beyond 32 signed bits is an error.
      const offset = v(o, 'target') - pcOf(a, 'arm');
      if (offset >= 2 ** 31 || offset < -(2 ** 31)) {
        return undefined;
      }
      const field = subtract
        ? encodeArmImmediate(wrap32(-offset))
        : offset >= 0
          ? encodeArmImmediate(offset)
          : undefined;
      return field === undefined ? undefined : { cond: v(o, 'cond'), rd: v(o, 'rd'), imm12: field };
    },
    raw: (f) => {
      const field = v(f, 'imm12');
      if (!isCanonicalArmImmediate(field)) {
        return 'as-alias';
      }
      return subtract && decodeArmImmediate(field) === 0 ? 'as-alias' : null;
    },
  });
}

const FORMS: readonly Form[] = ['imm', 'ims', 'rs'];
const WRITABLE: readonly number[] = OPCODES.map((_, op) => op).filter((op) => !shapeOf(op).test);

/** The data-processing rows in decode order: pc writes, adr, then every opcode and form. */
export const ARM_DP_ROWS: readonly Row[] = [
  ...WRITABLE.flatMap((op) => FORMS.map((form) => dpRow(op, form, true))),
  adrRow(false),
  adrRow(true),
  ...OPCODES.flatMap((_, op) => FORMS.map((form) => dpRow(op, form, false))),
];

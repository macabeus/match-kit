// The ARM (ARMv4T) data-processing rows: 16 opcodes in three operand forms (rotated immediate,
// register shifted by an immediate, register shifted by a register). Writes to pc get rows of their
// own so the flow class is a table fact: `add pc, ...` is add-pc and every other data-processing
// write to pc is mov-pc. `add`/`sub` from pc with a rotated immediate print as `adr`.
import { wrap32 } from '../bits.js';
import { PC, SP } from '../names.js';
import type { Fields, Operands, RawReason, RegisterSpec } from '../types.js';
import { bits, operand } from './access.js';
import {
  constField,
  constOperands,
  decodeArmImmediate,
  encodeArmImmediate,
  isCanonicalArmImmediate,
} from './arm-immediate.js';
import { shiftFields, shiftOperands } from './arm-shift.js';
import { pcOf } from './pc-relative.js';
import {
  type FromOperands,
  type Row,
  type RowOptions,
  type ToOperands,
  cond,
  flag,
  imm,
  reg,
  rotImm,
  row,
  shiftType,
} from './row.js';

/** The 16 operations, in opcode order: the index is the opcode field. */
const OPERATIONS = [
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
] as const;
type Operation = (typeof OPERATIONS)[number];

/** tst, teq, cmp and cmn write only the flags: no rd, and no `s` to spell. */
const isTest = (operation: Operation): boolean => ['tst', 'teq', 'cmp', 'cmn'].includes(operation);
/** mov and mvn have no first operand. */
const isMove = (operation: Operation): boolean => operation === 'mov' || operation === 'mvn';

/**
 * The form of the second operand, as row ids spell it: `imm` a rotated immediate, `reg` a register, shifted by
 * an immediate amount or not at all, `rr` a register shifted by a register (Arm's i, r and rr).
 */
type Form = 'imm' | 'reg' | 'rr';
const FORMS: readonly Form[] = ['imm', 'reg', 'rr'];

const FORM_MASK: Readonly<Record<Form, number>> = { imm: 0x0fe0_0000, reg: 0x0fe0_0010, rr: 0x0fe0_0090 };
const FORM_MATCH: Readonly<Record<Form, number>> = { imm: 0x0200_0000, reg: 0, rr: 0x10 };

interface SecondOperand {
  readonly text: string;
  readonly fields: NonNullable<RowOptions['fields']>;
  readonly toOperands: (f: Fields) => Operands;
  readonly fromOperands: (o: Operands) => Fields | undefined;
}

const SECOND_OPERAND: Readonly<Record<Form, SecondOperand>> = {
  imm: {
    text: '{const}',
    fields: [rotImm('imm12')],
    toOperands: (f) => constOperands(bits(f, 'imm12')),
    fromOperands: (o) => {
      const field = constField(o);
      return field === undefined ? undefined : { imm12: field };
    },
  },
  reg: {
    text: '{rm}{shift}',
    fields: [imm('imm5', 7, 5), shiftType('stype', 5), reg('rm', 0, 4)],
    toOperands: (f) => ({ rm: bits(f, 'rm'), ...shiftOperands(bits(f, 'stype'), bits(f, 'imm5')) }),
    fromOperands: (o) => {
      const shift = shiftFields(operand(o, 'shift'), operand(o, 'amount'));
      return shift === undefined ? undefined : { rm: operand(o, 'rm'), ...shift };
    },
  },
  rr: {
    text: '{rm}{rshift}',
    fields: [reg('rs', 8, 4), shiftType('stype', 5), reg('rm', 0, 4)],
    toOperands: (f) => ({ rm: bits(f, 'rm'), rs: bits(f, 'rs'), shift: bits(f, 'stype') }),
    fromOperands: (o) =>
      operand(o, 'shift') > 3 ? undefined : { rm: operand(o, 'rm'), rs: operand(o, 'rs'), stype: operand(o, 'shift') },
  },
};

/** Whether the second operand is a register as it is: no shift, no rotation. */
const isPlainRegister = (o: Operands): boolean =>
  o.rm !== undefined && o.rs === undefined && operand(o, 'shift') === 0 && operand(o, 'amount') === 0;

/**
 * What a data-processing instruction writes: rd, unless it only tests. The value is followed to its sources
 * where it is a copy or a sum of registers: `mov rd, rm`, `add rd, rn, #imm` and `add rd, rn, rm`.
 */
function registersOf(operation: Operation, form: Form): RowOptions['registers'] {
  if (isTest(operation)) {
    return undefined;
  }
  if (operation === 'mov' && form === 'reg') {
    return (o): RegisterSpec => (isPlainRegister(o) ? { writes: ['rd'], from: ['rm'] } : { writes: ['rd'] });
  }
  if (operation === 'add' && form === 'imm') {
    return { writes: ['rd'], from: ['rn'] };
  }
  if (operation === 'add' && form === 'reg') {
    return (o): RegisterSpec => (isPlainRegister(o) ? { writes: ['rd'], from: ['rn', 'rm'] } : { writes: ['rd'] });
  }
  return { writes: ['rd'] };
}

interface DataProcessingRow {
  readonly operation: Operation;
  readonly form: Form;
  /** The row of the encodings whose rd is pc: a jump, so its flow class differs. */
  readonly writesPc: boolean;
}

function dataProcessingRow({ operation, form, writesPc }: DataProcessingRow): Row {
  const opcode = OPERATIONS.indexOf(operation);
  const test = isTest(operation);
  const move = isMove(operation);
  const second = SECOND_OPERAND[form];
  const mnemonic = test ? `${operation}{c}` : `${operation}{s}{c}`;
  const first = test ? '{rn}' : move ? '{rd}' : '{rd}, {rn}';
  const fields = [cond(), ...(test ? [] : [flag('s', 20)]), reg('rn', 16, 4), reg('rd', 12, 4), ...second.fields];

  const toOperands: ToOperands = (f) => ({
    cond: bits(f, 'cond'),
    ...(test ? {} : { s: bits(f, 's'), rd: bits(f, 'rd') }),
    ...(move ? {} : { rn: bits(f, 'rn') }),
    ...second.toOperands(f),
  });
  const fromOperands: FromOperands = (o) => {
    // as turns `add rd, pc, #v` (no s, no explicit rotation) into a pc-relative fixup: a v of 2^31 or
    // more becomes a sub of its negation, or an error, so only smaller values keep this encoding.
    const pcRelative = operation === 'add' && form === 'imm' && o.rn === PC && o.s !== 1 && o.explicit !== 1;
    if (pcRelative && operand(o, 'imm') >= 2 ** 31) {
      return undefined;
    }
    const secondFields = second.fromOperands(o);
    if (secondFields === undefined) {
      return undefined;
    }
    return {
      cond: operand(o, 'cond'),
      ...(test ? {} : { s: operand(o, 's') }),
      rd: test ? 0 : operand(o, 'rd'),
      rn: move ? 0 : operand(o, 'rn'),
      ...secondFields,
    };
  };

  const raw = (f: Fields): RawReason | null => {
    if (test && bits(f, 'rd') !== 0) {
      return 'sbz-set';
    }
    if (move && bits(f, 'rn') !== 0) {
      return 'sbz-set';
    }
    if (form === 'rr') {
      const registers = [
        bits(f, 'rm'),
        bits(f, 'rs'),
        ...(test ? [] : [bits(f, 'rd')]),
        ...(move ? [] : [bits(f, 'rn')]),
      ];
      if (registers.includes(PC)) {
        return 'unpredictable';
      }
    }
    return null;
  };

  // `add sp, sp, #imm` and `sub sp, sp, #imm` move the stack.
  const direction = operation === 'add' ? 1 : operation === 'sub' ? -1 : 0;
  const stack =
    form === 'imm' && direction !== 0 && !writesPc
      ? (f: Fields): number =>
          bits(f, 'rd') === SP && bits(f, 'rn') === SP ? direction * decodeArmImmediate(bits(f, 'imm12')) : 0
      : undefined;
  const registers = registersOf(operation, form);
  // A test has no S bit to choose: it is fixed at 1. A pc row fixes rd.
  const fixed = (test ? 1 << 20 : 0) | (writesPc ? PC << 12 : 0);
  return row(`arm.${operation}_${form}${writesPc ? '_pc' : ''}`, 'arm', {
    mask: FORM_MASK[form] | fixed,
    match: FORM_MATCH[form] | (opcode << 21) | fixed,
    fields,
    syntax: `${mnemonic} ${first}, ${second.text}`,
    flow: writesPc ? (operation === 'add' ? 'add-pc' : 'mov-pc') : 'next',
    toOperands,
    fromOperands,
    raw,
    ...(stack === undefined ? {} : { stack }),
    ...(registers === undefined ? {} : { registers }),
  });
}

/** `adr rd, label`: add or sub rd, pc, #imm, as GNU as picks for the label's offset. */
function adrRow(subtract: boolean): Row {
  return row(subtract ? 'arm.adr_sub' : 'arm.adr_add', 'arm', {
    mask: 0x0fff_0000,
    match: subtract ? 0x024f_0000 : 0x028f_0000,
    fields: [cond(), reg('rd', 12, 4), rotImm('imm12')],
    syntax: 'adr{c} {rd}, {target}',
    flow: 'adr',
    asPriority: subtract ? 1 : 0,
    registers: { writes: ['rd'] },
    toOperands: (f, a) => {
      const value = decodeArmImmediate(bits(f, 'imm12'));
      return {
        cond: bits(f, 'cond'),
        rd: bits(f, 'rd'),
        target: wrap32(pcOf(a, 'arm') + (subtract ? -value : value)),
      };
    },
    fromOperands: (o, a) => {
      // as resolves the label to a signed offset: add #off when it is non-negative and encodable, else
      // sub #-off (taken modulo 2^32); an offset beyond 32 signed bits is an error.
      const offset = operand(o, 'target') - pcOf(a, 'arm');
      if (offset >= 2 ** 31 || offset < -(2 ** 31)) {
        return undefined;
      }
      const field = subtract
        ? encodeArmImmediate(wrap32(-offset))
        : offset >= 0
          ? encodeArmImmediate(offset)
          : undefined;
      return field === undefined ? undefined : { cond: operand(o, 'cond'), rd: operand(o, 'rd'), imm12: field };
    },
    raw: (f) => {
      const field = bits(f, 'imm12');
      if (!isCanonicalArmImmediate(field)) {
        return 'as-alias';
      }
      return subtract && decodeArmImmediate(field) === 0 ? 'as-alias' : null;
    },
  });
}

const everyForm = (operation: Operation, writesPc: boolean): Row[] =>
  FORMS.map((form) => dataProcessingRow({ operation, form, writesPc }));

/** The data-processing rows in decode order: pc writes, adr, then every operation and form. */
export const ARM_DP_ROWS: readonly Row[] = [
  ...OPERATIONS.filter((operation) => !isTest(operation)).flatMap((operation) => everyForm(operation, true)),
  adrRow(false),
  adrRow(true),
  ...OPERATIONS.flatMap((operation) => everyForm(operation, false)),
];

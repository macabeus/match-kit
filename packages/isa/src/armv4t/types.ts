// The instruction model: table rows (InsnSpec), decoded instructions (Insn), their
// control-flow classes, the encoding reasons an instruction prints raw, and the text-side types of the
// printer. Rows live only in the tables (thumb-table.ts, arm-table.ts); everything here is plain
// data except the optional row functions (`stack`, `raw`).
import type { Addr, Mode } from './address.js';

/** A row id: `<mode>.<name>`, e.g. 'thumb.ldr_literal', 'arm.add_imm'. */
export type SpecId = `${'thumb' | 'arm'}.${string}`;

export type FieldKind = 'reg' | 'imm' | 'simm' | 'cond' | 'reglist' | 'shift' | 'rot-imm' | 'pc-rel' | 'bl-off';

/** A contiguous bit field of an encoding; its value in `Fields` is the raw unsigned bits. */
export interface Field {
  readonly name: string;
  readonly lo: number;
  readonly width: number;
  readonly kind: FieldKind;
  /** The operand is the field value times this (byte offsets of scaled immediates). */
  readonly scale?: number;
}

/** The raw bits of an encoding, by the names of its row's fields. */
export type Fields = Readonly<Record<string, number>>;

/** Every operand a syntax template can name. */
export const OPERAND_NAMES = [
  // registers
  'rd',
  'rn',
  'rm',
  'rs',
  'rdlo',
  'rdhi',
  // an immediate in bytes or bits as written, an address, a register mask
  'imm',
  'target',
  'reglist',
  // the mnemonic's suffixes: condition, set flags
  'cond',
  's',
  // addressing: pre-indexed, add, writeback, user bank
  'p',
  'u',
  'w',
  'user',
  // a shift (0..3 lsl lsr asr ror, 4 rrx) and its amount
  'shift',
  'amount',
  // a rotated immediate: its rotation, and whether the text must spell it
  'rot',
  'explicit',
  // status registers: spsr, and the field mask
  'r',
  'mask',
] as const;
export type OperandName = (typeof OPERAND_NAMES)[number];

/** What an instruction's text says, as numbers: register numbers, immediates, label addresses. */
export type Operands = Readonly<Partial<Record<OperandName, number>>>;

/**
 * The control-flow class of a row: what is known from the table alone, before the operands. `decode` turns it
 * into a `Flow`, which needs them: a `bx` is a return, a mode switch or an indirect jump by its register.
 *
 * | class         | Flow                                                                    |
 * | ------------- | ----------------------------------------------------------------------- |
 * | `next`        | `next`                                                                  |
 * | `branch`      | `branch` (ARM: conditional unless the condition is al)                  |
 * | `cond-branch` | `branch`, conditional                                                   |
 * | `bl`          | `call`                                                                  |
 * | `bx`          | `return` (bx lr), `mode-switch` (Thumb bx pc) or `indirect`             |
 * | `load-pc`     | `return` (the base is sp) or `indirect`                                 |
 * | `mov-pc`      | `return` (mov pc, lr) or `indirect`                                     |
 * | `add-pc`      | `indirect`                                                              |
 * | `pool-load`   | `pool-load`                                                             |
 * | `adr`         | `adr`                                                                   |
 * | `swi`         | `interrupt`                                                             |
 * | `bl-prefix`   | `next` (the first half of a bl alone: it only sets lr)                  |
 * | `bl-suffix`   | `indirect` through lr (the second half alone)                           |
 * | `invalid`     | `invalid`                                                               |
 */
export type FlowClass =
  | 'next'
  | 'branch'
  | 'cond-branch'
  | 'bl'
  | 'bx'
  | 'load-pc'
  | 'mov-pc'
  | 'add-pc'
  | 'pool-load'
  | 'adr'
  | 'swi'
  | 'bl-prefix'
  | 'bl-suffix'
  | 'invalid';

/**
 * Why an instruction prints as `.inst`: encoding reasons only.
 *
 * - `undefined`: no ARMv4T instruction has this encoding.
 * - `unpredictable`: the architecture leaves the behaviour open, and GNU as refuses or changes the text.
 * - `sbz-set`: a should-be-zero bit is set, which no text expresses.
 * - `as-alias`: GNU as assembles this text to another encoding of the same instruction.
 * - `bl-half`: one half of a Thumb `bl` without the other. It is a defined instruction, with no text of its own.
 * - `no-roundtrip`: the text did not assemble back to these bytes (an address without a label, for example).
 */
export type RawReason = 'undefined' | 'unpredictable' | 'sbz-set' | 'as-alias' | 'bl-half' | 'no-roundtrip';

/** Every RawReason, in the order reports list them. */
export const RAW_REASONS: readonly RawReason[] = [
  'undefined',
  'unpredictable',
  'sbz-set',
  'as-alias',
  'bl-half',
  'no-roundtrip',
];

/**
 * What an instruction writes to the core registers, as row data over its operand names: `writes` names
 * operands holding a register it writes, `reglist` an operand holding a register mask it writes, `fixed` a
 * mask of registers it always writes (a call's clobbers), and `from` the operands the written value is a
 * copy, a sum or the load address of; a written value computed any other way (a constant, other
 * arithmetic, a byte or halfword load) has no `from`. sp updates are the row's `stack`, and a branch's pc
 * its Flow.
 */
export interface RegisterSpec {
  readonly writes?: readonly OperandName[];
  readonly reglist?: OperandName;
  readonly fixed?: number;
  readonly from?: readonly OperandName[];
}

/** The register effect of one decoded instruction: a bit per register written (bit 15 is pc), and the registers the written value comes from. */
export interface RegisterEffect {
  readonly writes: number;
  readonly from: readonly number[];
}

/** A table row; lives only in the isa tables. */
export interface InsnSpec {
  readonly id: SpecId;
  readonly mode: Mode;
  readonly size: 2 | 4;
  /** Decode: `(w & mask) === match`, first row wins. */
  readonly mask: number;
  readonly match: number;
  readonly fields: readonly Field[];
  /** GNU as unified syntax with operand placeholders: 'ldr {rd}, {target}'. */
  readonly syntax: string;
  readonly flow: FlowClass;
  /** GNU as's choice when two rows parse one text: the lowest value wins. */
  readonly asPriority: number;
  /** The sp delta in bytes (push, pop, add sp, ...); 0 when the instruction leaves sp alone. */
  readonly stack?: (f: Fields) => number;
  /** The encoding reason `as` will not reproduce these fields, or null when it will. */
  readonly raw?: (f: Fields) => RawReason | null;
}

export type Flow =
  | { readonly kind: 'next' }
  | { readonly kind: 'branch'; readonly target: Addr; readonly conditional: boolean }
  | { readonly kind: 'call'; readonly target: Addr }
  | { readonly kind: 'return'; readonly via: 'bx-lr' | 'pop-pc' | 'mov-pc-lr' }
  /**
   * `reg` is the jump register (bx, mov-pc, add-pc), the base pc is loaded through (load-pc), or lr for the
   * second half of a Thumb bl standing alone (bl-suffix), which jumps to lr plus its offset.
   */
  | {
      readonly kind: 'indirect';
      readonly reg: number;
      readonly via: 'bx' | 'mov-pc' | 'add-pc' | 'load-pc' | 'bl-suffix';
    }
  /** A literal-pool load; `rd` 15 (ARM `ldr pc, [pc, #imm]`) transfers control to the loaded word. */
  | { readonly kind: 'pool-load'; readonly pool: Addr; readonly rd: number }
  | { readonly kind: 'adr'; readonly target: Addr }
  | { readonly kind: 'interrupt'; readonly imm: number }
  | { readonly kind: 'mode-switch'; readonly target: Addr }
  | { readonly kind: 'invalid' };

/** A decoded instruction; plain data: the row is named, not embedded. */
export interface Insn {
  readonly addr: Addr;
  readonly mode: Mode;
  readonly size: 2 | 4;
  /** The original bytes as a little-endian value (a Thumb `bl`: first | second << 16). */
  readonly word: number;
  readonly specId: SpecId;
  readonly fields: Fields;
  readonly flow: Flow;
}

/** How the printer names addresses; it never invents a name. */
export interface SymbolResolver {
  labelFor(addr: Addr, from: Addr): string | undefined;
  /** parse() maps a label back. */
  addressOf(name: string): Addr | undefined;
}

/** One row that accepts a parsed text, with the operand values that row reads from it. */
export interface ParsedCandidate {
  readonly specId: SpecId;
  readonly operands: Operands;
}

/** One instruction text read back by `parse`: every row that accepts it, each with its own reading. */
export interface ParsedInsn {
  readonly mode: Mode;
  readonly text: string;
  readonly mnemonic: string;
  /** Every row whose syntax accepts the text, in table order, once each (its first reading). */
  readonly candidates: readonly ParsedCandidate[];
}

/** The encoding `assemble` picks for a parsed text at an address. */
export interface Assembled {
  readonly specId: SpecId;
  readonly size: 2 | 4;
  readonly word: number;
}

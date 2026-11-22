// The instruction model: table rows (InsnSpec), decoded instructions (Insn), their
// control-flow classes, the encoding reasons an instruction prints raw, and the text-side types of the
// printer. Rows live only in the tables (thumb-table.ts, arm-table.ts); everything here is plain
// data except the optional row functions (`stack`, `raw`).
import type { Addr, Mode } from './address.js';

/** A row id: `<mode>.<name>`, e.g. 'thumb.ldr_pc', 'arm.add_imm'. */
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

/** Field values by field name (raw bits), or operand values by operand name. */
export type Fields = Readonly<Record<string, number>>;

/** The control-flow class of a row; `decode` turns it into a `Flow` with targets. */
export type FlowKind =
  | 'next'
  | 'branch'
  | 'cond-branch'
  | 'bl'
  | 'bx'
  | 'pop-pc'
  | 'mov-pc'
  | 'add-pc'
  | 'pc-load'
  | 'adr'
  | 'swi'
  | 'invalid';

/** Why an instruction prints as `.inst`: encoding reasons only. */
export type RawReason = 'undefined' | 'unpredictable' | 'sbz-set' | 'as-alias' | 'no-roundtrip';

/** Every RawReason, in the order reports list them. */
export const RAW_REASONS: readonly RawReason[] = ['undefined', 'unpredictable', 'sbz-set', 'as-alias', 'no-roundtrip'];

/**
 * What an instruction writes to the core registers, as row data over its operand names: `writes` names
 * operands holding a register it writes, `list` an operand holding a register mask it writes, `fixed` a
 * mask of registers it always writes (a call's clobbers), and `from` the operands the written value is a
 * copy, a sum or the load address of; a written value computed any other way (a constant, other
 * arithmetic, a byte or halfword load) has no `from`. sp updates are the row's `stack`, and a branch's pc
 * its Flow.
 */
export interface RegisterSpec {
  readonly writes?: readonly string[];
  readonly list?: string;
  readonly fixed?: number;
  readonly from?: readonly string[];
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
  readonly flow: FlowKind;
  /** GNU as's choice when two rows parse one text: the lowest value wins. */
  readonly asPriority: number;
  /** The sp delta in bytes (push, pop, add sp, ...); 0 when the instruction leaves sp alone. */
  readonly stack?: (f: Fields) => number;
  /** The encoding reason `as` will not reproduce these fields, or null when it will. */
  readonly raw?: (f: Fields) => RawReason | null;
  /** The registers it writes (Thumb rows; absent: none). */
  readonly registers?: RegisterSpec;
}

export type Flow =
  | { readonly kind: 'next' }
  | { readonly kind: 'branch'; readonly target: Addr; readonly conditional: boolean }
  | { readonly kind: 'bl'; readonly target: Addr }
  | { readonly kind: 'return'; readonly via: 'bx-lr' | 'pop-pc' | 'mov-pc-lr' }
  /** `reg` is the jump register (bx, mov-pc, add-pc) or the base pc is loaded through (load-pc). */
  | { readonly kind: 'indirect'; readonly reg: number; readonly via: 'bx' | 'mov-pc' | 'add-pc' | 'load-pc' }
  /** A literal-pool load; `rd` 15 (ARM `ldr pc, [pc, #imm]`) transfers control to the loaded word. */
  | { readonly kind: 'pool-load'; readonly pool: Addr; readonly rd: number }
  | { readonly kind: 'adr'; readonly target: Addr }
  | { readonly kind: 'swi'; readonly imm: number }
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
  /** Operand values (registers, immediates, label addresses) by operand name. */
  readonly operands: Fields;
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

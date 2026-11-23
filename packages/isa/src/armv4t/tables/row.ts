// The row builder of the tables. A row is an InsnSpec (the public, plain part: mask, match, fields, syntax, flow
// class, asPriority, stack, raw) plus what only this package reads: the codec between the row's field bits and
// the operands its syntax names, its compiled syntax forms (the printed one first, then parse-only aliases) and
// the registers it writes. The tables (thumb.ts, arm-*.ts) are lists of rows built here.
import { type Addr, type Mode, insnUnit } from '../address.js';
import { type CompiledForm, compileForm } from '../text/template.js';
import {
  type Field,
  type FieldKind,
  type Fields,
  type FlowClass,
  type InsnSpec,
  OPERAND_NAMES,
  type OperandName,
  type Operands,
  type RawReason,
  type RegisterSpec,
  type SpecId,
} from '../types.js';

/** Field bits to operands (registers, immediates in bytes, label addresses). */
export type ToOperands = (f: Fields, addr: Addr) => Operands;
/** Operands to field bits, or undefined when this row cannot encode them at `addr`. */
export type FromOperands = (o: Operands, addr: Addr) => Fields | undefined;

export interface Row {
  readonly spec: InsnSpec;
  /** forms[0] is the printed syntax (spec.syntax); the rest are parse-only aliases. Compiled on first use. */
  readonly forms: readonly CompiledForm[];
  readonly toOperands: ToOperands;
  readonly fromOperands: FromOperands;
  /** Fields whose text GNU as rejects (an error, not a warning): assemble gives nothing for them. */
  readonly rejects: (f: Fields) => boolean;
  /** False for rows that always print raw (undefined spaces, lone bl halves): never parsed. */
  readonly printable: boolean;
  /** The registers the instruction writes, over its operands; absent when it writes none. */
  readonly registers?: (o: Operands) => RegisterSpec;
}

/** Fields whose text GNU as rejects as an error. */
export interface Rejection {
  /** Why those fields print raw. `raw`'s own reasons come first. */
  readonly reason: RawReason;
  readonly when: (f: Fields) => boolean;
}

export interface RowOptions {
  readonly mask: number;
  readonly match: number;
  readonly size?: 2 | 4;
  readonly fields?: readonly Field[];
  readonly syntax: string;
  readonly aliases?: readonly string[];
  readonly flow?: FlowClass;
  readonly asPriority?: number;
  readonly stack?: (f: Fields) => number;
  /** The encoding reason GNU as will not reproduce these fields from their text, or null when it will. */
  readonly raw?: (f: Fields) => RawReason | null;
  /**
   * Fields whose text GNU as refuses outright. One statement for two effects: they print raw for `reason`, and
   * `assemble` gives nothing for a text that would encode to them.
   */
  readonly rejected?: Rejection;
  /** The row always prints raw for this reason. */
  readonly rawOnly?: RawReason;
  /** The registers it writes: a fixed description, or one that depends on the operands (writeback). */
  readonly registers?: RegisterSpec | ((o: Operands) => RegisterSpec);
  readonly toOperands?: ToOperands;
  readonly fromOperands?: FromOperands;
}

const OPERAND_NAME_SET: ReadonlySet<string> = new Set(OPERAND_NAMES);

function isOperandName(name: string): name is OperandName {
  return OPERAND_NAME_SET.has(name);
}

/** The default codec: each field named as an operand is that operand, times its scale. */
function defaultToOperands(fields: readonly Field[]): ToOperands {
  const named = fields.filter((field) => isOperandName(field.name));
  return (f) => {
    const out: Partial<Record<OperandName, number>> = {};
    for (const field of named) {
      out[field.name as OperandName] = (f[field.name] ?? 0) * (field.scale ?? 1);
    }
    return out;
  };
}

function defaultFromOperands(fields: readonly Field[]): FromOperands {
  return (o) => {
    const out: Record<string, number> = {};
    for (const field of fields) {
      const value = isOperandName(field.name) ? o[field.name] : undefined;
      if (value === undefined) {
        return undefined;
      }
      out[field.name] = value / (field.scale ?? 1);
    }
    return out;
  };
}

/** `raw`, then the rejection's reason. */
function rawOf(options: RowOptions): InsnSpec['raw'] {
  const { raw, rejected, rawOnly } = options;
  if (rawOnly !== undefined) {
    return () => rawOnly;
  }
  if (rejected === undefined) {
    return raw;
  }
  return (f) => raw?.(f) ?? (rejected.when(f) ? rejected.reason : null);
}

/** Builds one row. */
export function row(id: SpecId, mode: Mode, options: RowOptions): Row {
  const fields = options.fields ?? [];
  const printable = options.rawOnly === undefined;
  const raw = rawOf(options);
  const registers = options.registers;
  const spec: InsnSpec = {
    id,
    mode,
    size: options.size ?? insnUnit(mode),
    mask: options.mask >>> 0,
    match: options.match >>> 0,
    fields,
    syntax: options.syntax,
    flow: options.flow ?? (printable ? 'next' : 'invalid'),
    asPriority: options.asPriority ?? 0,
    ...(options.stack === undefined ? {} : { stack: options.stack }),
    ...(raw === undefined ? {} : { raw }),
  };
  const templates = [options.syntax, ...(options.aliases ?? [])];
  let forms: readonly CompiledForm[] | undefined;
  return {
    spec,
    get forms() {
      forms ??= templates.map(compileForm);
      return forms;
    },
    toOperands: options.toOperands ?? defaultToOperands(fields),
    fromOperands: options.fromOperands ?? defaultFromOperands(fields),
    rejects: options.rejected?.when ?? ((): boolean => false),
    printable,
    ...(registers === undefined ? {} : { registers: typeof registers === 'function' ? registers : () => registers }),
  };
}

function makeField(name: string, lo: number, width: number, kind: FieldKind, scale?: number): Field {
  return scale === undefined ? { name, lo, width, kind } : { name, lo, width, kind, scale };
}

/** A register field (3 bits by default). */
export function reg(name: string, lo: number, width = 3): Field {
  return makeField(name, lo, width, 'reg');
}

/** An unsigned immediate field whose operand is the value times `scale`. */
export function imm(name: string, lo: number, width: number, scale?: number): Field {
  return makeField(name, lo, width, 'imm', scale);
}

/** A one-bit flag. */
export function flag(name: string, lo: number): Field {
  return makeField(name, lo, 1, 'imm');
}

/** The condition field: bits 31..28 in ARM, 11..8 in the Thumb conditional branch. */
export function cond(lo = 28): Field {
  return makeField('cond', lo, 4, 'cond');
}

export function reglist(name: string, lo: number, width: number): Field {
  return makeField(name, lo, width, 'reglist');
}

export function shiftType(name: string, lo: number): Field {
  return makeField(name, lo, 2, 'shift');
}

export function rotImm(name: string): Field {
  return makeField(name, 0, 12, 'rot-imm');
}

export function pcRel(name: string, lo: number, width: number, scale: number): Field {
  return makeField(name, lo, width, 'pc-rel', scale);
}

export function blOff(name: string, lo: number): Field {
  return makeField(name, lo, 11, 'bl-off');
}

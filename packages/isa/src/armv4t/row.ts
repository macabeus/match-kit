// The row builder of the isa tables. A row is an InsnSpec (the public, plain part: mask, match,
// fields, syntax, flow, asPriority, stack, raw) plus the internal codec between its field bits and
// the operand values its syntax names, and its compiled syntax forms (the printed one first, then
// parse-only aliases). The tables (thumb-table.ts, arm-*.ts) are lists of rows built here.
import type { Addr, Mode } from './address.js';
import { insnUnit } from './address.js';
import { compileForm } from './template.js';
import type { CompiledForm } from './template.js';
import type { Field, FieldKind, Fields, FlowKind, InsnSpec, RawReason, RegisterSpec, SpecId } from './types.js';

/** Field bits to operand values (registers, immediates in bytes, label addresses). */
export type ToOperands = (f: Fields, addr: Addr) => Fields;
/** Operand values to field bits, or undefined when this row cannot encode them at `addr`. */
export type FromOperands = (o: Fields, addr: Addr) => Fields | undefined;

export interface Row {
  readonly spec: InsnSpec;
  /** forms[0] is the printed syntax (spec.syntax); the rest are parse-only aliases. */
  readonly forms: readonly CompiledForm[];
  readonly toOps: ToOperands;
  readonly fromOps: FromOperands;
  /** Fields whose text GNU as rejects (an error, not a warning): assemble gives nothing for them. */
  readonly refuse: (f: Fields) => boolean;
  /** False for rows that always print raw (undefined spaces, lone bl halves): never parsed. */
  readonly printable: boolean;
}

export interface RowOptions {
  readonly mask: number;
  readonly match: number;
  readonly size?: 2 | 4;
  readonly fields?: readonly Field[];
  readonly syntax: string;
  readonly aliases?: readonly string[];
  readonly flow?: FlowKind;
  readonly asPriority?: number;
  readonly stack?: (f: Fields) => number;
  readonly raw?: (f: Fields) => RawReason | null;
  readonly registers?: RegisterSpec;
  /** The row always prints raw for this reason. */
  readonly rawOnly?: RawReason;
  readonly toOps?: ToOperands;
  readonly fromOps?: FromOperands;
  readonly refuse?: (f: Fields) => boolean;
}

/** The default codec: each field is the operand of the same name, times its scale. */
function defaultToOps(fields: readonly Field[]): ToOperands {
  return (f) => {
    const out: Record<string, number> = {};
    for (const field of fields) {
      out[field.name] = (f[field.name] ?? 0) * (field.scale ?? 1);
    }
    return out;
  };
}

function defaultFromOps(fields: readonly Field[]): FromOperands {
  return (o) => {
    const out: Record<string, number> = {};
    for (const field of fields) {
      const value = o[field.name];
      if (value === undefined) {
        return undefined;
      }
      out[field.name] = value / (field.scale ?? 1);
    }
    return out;
  };
}

/** Builds one row. */
export function row(id: SpecId, mode: Mode, options: RowOptions): Row {
  const fields = options.fields ?? [];
  const rawOnly = options.rawOnly;
  const raw = rawOnly === undefined ? options.raw : (): RawReason => rawOnly;
  const spec: InsnSpec = {
    id,
    mode,
    size: options.size ?? insnUnit(mode),
    mask: options.mask >>> 0,
    match: options.match >>> 0,
    fields,
    syntax: options.syntax,
    flow: options.flow ?? (rawOnly === undefined ? 'next' : 'invalid'),
    asPriority: options.asPriority ?? 0,
    ...(options.stack === undefined ? {} : { stack: options.stack }),
    ...(raw === undefined ? {} : { raw }),
    ...(options.registers === undefined ? {} : { registers: options.registers }),
  };
  return {
    spec,
    forms: [options.syntax, ...(options.aliases ?? [])].map(compileForm),
    toOps: options.toOps ?? defaultToOps(fields),
    fromOps: options.fromOps ?? defaultFromOps(fields),
    refuse: options.refuse ?? ((): boolean => false),
    printable: rawOnly === undefined,
  };
}

function field(name: string, lo: number, width: number, kind: FieldKind, scale?: number): Field {
  return scale === undefined ? { name, lo, width, kind } : { name, lo, width, kind, scale };
}

/** A register field (3 bits by default). */
export function reg(name: string, lo: number, width = 3): Field {
  return field(name, lo, width, 'reg');
}

/** An unsigned immediate field whose operand is the value times `scale`. */
export function imm(name: string, lo: number, width: number, scale?: number): Field {
  return field(name, lo, width, 'imm', scale);
}

/** A one-bit flag. */
export function flag(name: string, lo: number): Field {
  return field(name, lo, 1, 'imm');
}

/** The condition field: bits 31..28 in ARM, 11..8 in the Thumb conditional branch. */
export function cond(lo = 28): Field {
  return field('cond', lo, 4, 'cond');
}

export function reglist(name: string, lo: number, width: number): Field {
  return field(name, lo, width, 'reglist');
}

export function shiftType(name: string, lo: number): Field {
  return field(name, lo, 2, 'shift');
}

export function rotImm(name: string): Field {
  return field(name, 0, 12, 'rot-imm');
}

export function pcRel(name: string, lo: number, width: number, scale: number): Field {
  return field(name, lo, width, 'pc-rel', scale);
}

export function blOff(name: string, lo: number): Field {
  return field(name, lo, 11, 'bl-off');
}

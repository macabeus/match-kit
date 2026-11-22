// decode(mode, word, addr): the table lookup. Thumb goes through a 65,536-entry index from halfword to row; a bl
// prefix followed by a bl suffix (the high halfword of `word`) decodes as one 4-byte instruction. ARM goes
// through 4,096 buckets keyed on bits 27..20 and 7..4, each listing the rows those bits allow, in table order.
// Each index is built on the first decode of its mode. Decode never throws: every word matches a row, because
// each table ends with a catch-all row.
import type { Addr, Mode } from './address.js';
import { IsaInvariantError } from './errors.js';
import { flowOf } from './flow.js';
import { once } from './lazy.js';
import { COND_AL } from './names.js';
import { ROWS, rowOf } from './tables/registry.js';
import type { Row } from './tables/row.js';
import { THUMB_BL } from './tables/thumb.js';
import type { Fields, Insn, Operands } from './types.js';

function matches(row: Row, word: number): boolean {
  return (word & row.spec.mask) >>> 0 === row.spec.match;
}

/** The 16-bit Thumb rows: every Thumb row but the bl pair. */
const thumb16 = once((): readonly Row[] => ROWS.thumb.filter((r) => r.spec.size === 2));

/** The last row of a table: its catch-all, which every word not matched earlier decodes to. */
function catchAll(rows: readonly Row[], table: string): Row {
  const last = rows[rows.length - 1];
  if (last === undefined) {
    throw new IsaInvariantError(`isa tables: the ${table} table is empty`);
  }
  return last;
}

/**
 * Halfword to index into the 16-bit Thumb rows: the first row that matches it. Built on the first Thumb decode;
 * the loop reads the rows' masks and matches from typed arrays rather than calling `matches` 65,536 times over.
 */
const thumbIndex = once((): Uint16Array => {
  const rows = thumb16();
  const n = rows.length;
  const masks = Uint32Array.from(rows, (r) => r.spec.mask);
  const values = Uint32Array.from(rows, (r) => r.spec.match);
  const index = new Uint16Array(0x10000);
  for (let hw = 0; hw < 0x10000; hw++) {
    let at = 0;
    while (at < n && (hw & (masks[at] as number)) >>> 0 !== values[at]) {
      at++;
    }
    index[hw] = at < n ? at : n - 1;
  }
  return index;
});

/** The bucket key of an ARM word: bits 27..20, then bits 7..4. */
function armKey(word: number): number {
  return ((word >>> 16) & 0xff0) | ((word >>> 4) & 0xf);
}

/** For each key, the ARM rows those bits allow, in table order. Built on the first ARM decode. */
const armBuckets = once((): readonly (readonly Row[])[] => {
  const keys = ROWS.arm.map((r) => armKey(r.spec.match));
  const keyMasks = ROWS.arm.map((r) => armKey(r.spec.mask));
  const buckets: Row[][] = [];
  for (let key = 0; key < 0x1000; key++) {
    const bucket: Row[] = [];
    for (let i = 0; i < ROWS.arm.length; i++) {
      if (((key ^ (keys[i] as number)) & (keyMasks[i] as number)) === 0) {
        bucket.push(ROWS.arm[i] as Row);
      }
    }
    buckets.push(bucket);
  }
  return buckets;
});

/** The raw field values of `word` under a row. */
export function fieldsOf(row: Row, word: number): Fields {
  const out: Record<string, number> = {};
  for (const field of row.spec.fields) {
    out[field.name] = (word >>> field.lo) & (2 ** field.width - 1);
  }
  return out;
}

function armRow(word: number): Row {
  const bucket = armBuckets()[armKey(word)] ?? [];
  for (const r of bucket) {
    if (matches(r, word)) {
      return r;
    }
  }
  return catchAll(ROWS.arm, 'ARM');
}

/** Whether a Thumb halfword is the prefix of a bl pair (its high offset). */
export function isThumbBlPrefix(hw: number): boolean {
  return (hw & 0xf800) === 0xf000;
}

/** Whether a Thumb halfword is the suffix of a bl pair (its low offset). */
export function isThumbBlSuffix(hw: number): boolean {
  return (hw & 0xf800) === 0xf800;
}

/** Whether a Thumb halfword may be a b or bcc (bcc's space also holds swi and the undefined forms): decode decides. */
export function thumbMayBranchShort(hw: number): boolean {
  return (hw & 0xf000) === 0xd000 || (hw & 0xf800) === 0xe000;
}

/** Whether a Thumb halfword may be a PC-relative load (`ldr rd, [pc, #]`) or an adr (`add rd, pc, #`): decode decides. */
export function thumbMayReachPcRelative(hw: number): boolean {
  return (hw & 0xf800) === 0x4800 || (hw & 0xf800) === 0xa000;
}

/** Whether a Thumb halfword alone may name an address (a short branch, a PC-relative load, an adr); a bl is its prefix and suffix. */
export function thumbMayName(hw: number): boolean {
  return thumbMayBranchShort(hw) || thumbMayReachPcRelative(hw);
}

function thumbRow(word: number): Row {
  const hw = word & 0xffff;
  if (isThumbBlPrefix(hw) && isThumbBlSuffix(word >>> 16)) {
    return THUMB_BL;
  }
  const rows = thumb16();
  return rows[thumbIndex()[hw] as number] ?? catchAll(rows, 'Thumb');
}

/** The row `word` decodes to in `mode` (Thumb: the low halfword, paired with the high one for bl). */
export function rowFor(mode: Mode, word: number): Row {
  return mode === 'thumb' ? thumbRow(word >>> 0) : armRow(word >>> 0);
}

/**
 * Decodes the instruction at `addr`. Thumb: `word` holds the halfword at addr in its low 16 bits and
 * the one at addr + 2 (0 when absent) in its high 16 bits. ARM: the word at addr.
 */
export function decode(mode: Mode, word: number, addr: Addr): Insn {
  const row = rowFor(mode, word);
  const size = row.spec.size;
  const bytes = size === 2 ? word & 0xffff : word >>> 0;
  const fields = fieldsOf(row, bytes);
  return {
    addr,
    mode,
    size,
    word: bytes,
    specId: row.spec.id,
    fields,
    flow: flowOf(row.spec.flow, mode, row.toOperands(fields, addr), addr),
  };
}

/**
 * The Thumb decode word at `addr`: the halfword there, with the one at addr + 2 above it (a bl pair decodes as
 * one instruction). `read16` gives the little-endian halfword at an address, or undefined where there is none,
 * which reads as zero.
 */
export function thumbWordAt(read16: (addr: Addr) => number | undefined, addr: Addr): number {
  return (((read16(addr) ?? 0) & 0xffff) | (((read16(addr + 2) ?? 0) & 0xffff) << 16)) >>> 0;
}

/** What the instruction's text says, as numbers: its registers, immediates and the addresses it names. */
export function operandsOf(insn: Insn): Operands {
  return rowOf(insn.specId).toOperands(insn.fields, insn.addr);
}

/**
 * Whether `insn` executes only under a condition, read from its row's 'cond' field: a value other than
 * al. A row without one is unconditional in Thumb; in ARM only the NV space and the undefined catch-all
 * lack it, and they never execute as code, so they count as conditional.
 */
export function isConditional(insn: Insn): boolean {
  const field = rowOf(insn.specId).spec.fields.find((f) => f.kind === 'cond');
  if (field === undefined) {
    return insn.mode === 'arm';
  }
  return insn.fields[field.name] !== COND_AL;
}

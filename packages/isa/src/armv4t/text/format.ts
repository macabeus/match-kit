// format(insn, resolver): the instruction as GNU as unified syntax, every address operand through
// resolver.labelFor (the printer never invents a name). formatRaw(insn): the `.inst` fallback of the
// printing rule (roundtrip.ts), with the decoding in a comment that names addresses numerically.
import type { Addr } from '../address.js';
import { hex } from '../hex.js';
import { rowOf } from '../tables/registry.js';
import type { Row } from '../tables/row.js';
import type { Insn, Operands, SymbolResolver } from '../types.js';
import { renderForm } from './template.js';

/** The printed text of `row` for operand values `ops` at `addr`; undefined when a label is missing. */
export function formatOperands(
  row: Row,
  ops: Operands,
  addr: Addr,
  labelFor: (target: Addr) => string | undefined,
): string | undefined {
  const form = row.forms[0];
  return form === undefined ? undefined : renderForm(form, ops, { addr, label: labelFor });
}

/**
 * The instruction in GNU as unified syntax as `arm-none-eabi-as -mcpu=arm7tdmi` accepts it, or
 * undefined when the row prints raw or an address operand has no label.
 */
export function format(insn: Insn, resolver: SymbolResolver): string | undefined {
  const row = rowOf(insn.specId);
  if (!row.printable || (row.spec.raw?.(insn.fields) ?? null) !== null) {
    return undefined;
  }
  return formatOperands(row, row.toOperands(insn.fields, insn.addr), insn.addr, (target) =>
    resolver.labelFor(target, insn.addr),
  );
}

/**
 * What the instruction is, as text, whether or not `as` gives its bytes back from that text: for a debugger's
 * listing, never for a file to assemble. Unlike `format`, an instruction with a raw reason still prints (the
 * `adds r0, r0, #1` whose bytes `as` would encode another way). Undefined for a row with no instruction text (an
 * undefined encoding, a lone bl half) and when an address operand has no label.
 */
export function formatDecoding(insn: Insn, resolver: Pick<SymbolResolver, 'labelFor'>): string | undefined {
  const row = rowOf(insn.specId);
  if (!row.printable) {
    return undefined;
  }
  return formatOperands(row, row.toOperands(insn.fields, insn.addr), insn.addr, (target) =>
    resolver.labelFor(target, insn.addr),
  );
}

/** `.inst.n 0xXXXX @ <decoding>` (Thumb; `.inst.w` for a bl pair) or `.inst 0xXXXXXXXX @ <decoding>` (ARM). */
export function formatRaw(insn: Insn): string {
  const row = rowOf(insn.specId);
  const decoding =
    formatOperands(row, row.toOperands(insn.fields, insn.addr), insn.addr, (target) => `0x${hex(target)}`) ??
    row.spec.syntax;
  const reason = row.spec.raw?.(insn.fields) ?? null;
  const comment = reason === null || !row.printable ? decoding : `${decoding} (${reason})`;
  if (insn.mode === 'arm') {
    return `.inst 0x${hex(insn.word)} @ ${comment}`;
  }
  if (insn.size === 4) {
    return `.inst.w 0x${hex(insn.word & 0xffff, 4)}${hex(insn.word >>> 16, 4)} @ ${comment}`;
  }
  return `.inst.n 0x${hex(insn.word, 4)} @ ${comment}`;
}

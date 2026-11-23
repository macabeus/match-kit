// The printing rule: an instruction prints as a mnemonic only when its own text, parsed and
// assembled in process at its address, gives back its size and bytes. `printing` runs the rule once
// and returns what it produced, so callers that need the text and the assembled word do
// not run format, parse and assemble a second time.
import { assemble } from './assemble.js';
import { specOf } from './tables/registry.js';
import { format } from './text/format.js';
import { parse } from './text/parse.js';
import type { Assembled, Insn, RawReason, SymbolResolver } from './types.js';

/** What the printing rule decided: the mnemonic and its in-process encoding, or why it prints raw. */
export type Printing =
  | { readonly kind: 'mnemonic'; readonly text: string; readonly assembled: Assembled }
  | { readonly kind: 'raw'; readonly reason: RawReason };

/** The text and its encoding when assemble(parse(format(insn))) reproduces the size and word. */
function attempt(
  insn: Insn,
  resolver: SymbolResolver,
): { readonly text: string; readonly assembled: Assembled } | undefined {
  const text = format(insn, resolver);
  if (text === undefined) {
    return undefined;
  }
  const parsed = parse(text, insn.mode, insn.addr, resolver);
  if (parsed === undefined) {
    return undefined;
  }
  const assembled = assemble(parsed, insn.addr);
  return assembled !== undefined && assembled.size === insn.size && assembled.word === insn.word
    ? { text, assembled }
    : undefined;
}

/** The printing rule: the row's encoding reason first, then the round trip ('no-roundtrip' when it fails). */
export function printingOf(insn: Insn, resolver: SymbolResolver): Printing {
  const reason = specOf(insn.specId).raw?.(insn.fields) ?? null;
  if (reason !== null) {
    return { kind: 'raw', reason };
  }
  const done = attempt(insn, resolver);
  return done === undefined ? { kind: 'raw', reason: 'no-roundtrip' } : { kind: 'mnemonic', ...done };
}

/** assemble(parse(format(insn))) reproduces the instruction's size and word. */
export function roundTrips(insn: Insn, resolver: SymbolResolver): boolean {
  return attempt(insn, resolver) !== undefined;
}

/** Why the instruction prints raw: the row's encoding reason first, then 'no-roundtrip'; null when it prints. */
export function rawReason(insn: Insn, resolver: SymbolResolver): RawReason | null {
  const result = printingOf(insn, resolver);
  return result.kind === 'raw' ? result.reason : null;
}

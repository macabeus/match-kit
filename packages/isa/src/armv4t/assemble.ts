// assemble(parsed, addr): the encoding GNU as picks for a parsed text at an address. Candidates are tried in
// asPriority order (table order breaks ties); a candidate encodes when its codec turns its own reading of the
// operands into fields that fit their widths and those fields read back as the same operands, which is where
// range limits, alignment, Align(PC, 4) and immediate rotation are enforced. assembleText does the same from
// the text, and says why when it cannot.
import type { Addr, Mode } from './address.js';
import { fieldsOf, rowFor } from './decode.js';
import { encode, fieldsFit } from './encode.js';
import { rowOf, rowOrder } from './tables/registry.js';
import type { Row } from './tables/row.js';
import { mnemonicOf, parse, syntaxesOf } from './text/parse.js';
import type { Assembled, OperandName, Operands, ParsedInsn, SpecId, SymbolResolver } from './types.js';

/** Whether every operand both records name holds the same value. */
function agrees(derived: Operands, parsed: Operands): boolean {
  for (const key of Object.keys(derived) as OperandName[]) {
    const value = parsed[key];
    if (value !== undefined && value !== derived[key]) {
      return false;
    }
  }
  return true;
}

/** The word `row` encodes the operands as at `addr`, or undefined when it cannot. */
export function encodeOperands(row: Row, operands: Operands, addr: Addr): number | undefined {
  const fields = row.fromOperands(operands, addr);
  if (fields === undefined || !fieldsFit(row.spec, fields) || row.rejects(fields)) {
    return undefined;
  }
  const word = encode(row.spec, fields);
  // Read the word back: a field that overlaps bits the row fixes (rd = pc, pc in a list) must not
  // change what the text says.
  return agrees(row.toOperands(fieldsOf(row, word), addr), operands) ? word : undefined;
}

/** The encoding GNU as picks for `parsed` at `addr`, or undefined when no candidate fits. */
export function assemble(parsed: ParsedInsn, addr: Addr): Assembled | undefined {
  const candidates = parsed.candidates
    .map((c) => ({ row: rowOf(c.specId), operands: c.operands }))
    .sort((a, b) => a.row.spec.asPriority - b.row.spec.asPriority || rowOrder(a.row.spec.id) - rowOrder(b.row.spec.id));
  for (const { row, operands } of candidates) {
    const word = encodeOperands(row, operands, addr);
    if (word === undefined) {
      continue;
    }
    const decoded = rowFor(parsed.mode, word);
    return { specId: decoded.spec.id, size: row.spec.size, word };
  }
  return undefined;
}

/** Why a text has no encoding. */
export type AssembleFailure =
  /** No instruction of the mode has this mnemonic. */
  | { readonly kind: 'unknown-mnemonic'; readonly mnemonic: string }
  /** The operands name a label the resolver does not know. */
  | { readonly kind: 'unknown-label'; readonly label: string }
  /** The mnemonic exists, with other operands: `syntaxes` are the forms it takes. */
  | { readonly kind: 'operands'; readonly mnemonic: string; readonly syntaxes: readonly string[] }
  /**
   * The text reads as these rows, and none encodes it at this address: an operand out of range or misaligned,
   * or a combination GNU as refuses.
   */
  | { readonly kind: 'not-encodable'; readonly candidates: readonly SpecId[] };

export type AssembleResult =
  ({ readonly ok: true } & Assembled) | { readonly ok: false; readonly failure: AssembleFailure };

/** `parse` then `assemble`, in one call that says why a text has no encoding. */
export function assembleText(text: string, mode: Mode, addr: Addr, resolver: SymbolResolver): AssembleResult {
  const unknownLabels: string[] = [];
  const watching: SymbolResolver = {
    labelFor: (target, from) => resolver.labelFor(target, from),
    addressOf: (name) => {
      const address = resolver.addressOf(name);
      if (address === undefined) {
        unknownLabels.push(name);
      }
      return address;
    },
  };
  const parsed = parse(text, mode, addr, watching);
  if (parsed === undefined) {
    const mnemonic = mnemonicOf(text);
    const syntaxes = syntaxesOf(mode, mnemonic);
    if (syntaxes === undefined) {
      return { ok: false, failure: { kind: 'unknown-mnemonic', mnemonic } };
    }
    const label = unknownLabels[0];
    return label === undefined
      ? { ok: false, failure: { kind: 'operands', mnemonic, syntaxes } }
      : { ok: false, failure: { kind: 'unknown-label', label } };
  }
  const assembled = assemble(parsed, addr);
  return assembled === undefined
    ? { ok: false, failure: { kind: 'not-encodable', candidates: parsed.candidates.map((c) => c.specId) } }
    : { ok: true, ...assembled };
}

/** A failure as one sentence. */
export function describeAssembleFailure(failure: AssembleFailure): string {
  switch (failure.kind) {
    case 'unknown-mnemonic':
      return `no instruction is spelled '${failure.mnemonic}'`;
    case 'unknown-label':
      return `the label '${failure.label}' has no address`;
    case 'operands':
      return `'${failure.mnemonic}' takes other operands: ${failure.syntaxes.join(' | ')}`;
    case 'not-encodable':
      return `no encoding of ${failure.candidates.join(', ')} holds these operands at this address`;
  }
}

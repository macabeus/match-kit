// assemble(parsed, addr): the encoding GNU as picks for a parsed text at an address. Candidates are
// tried in asPriority order (table order breaks ties); a candidate encodes when its codec turns its own
// reading of the operands into fields that fit their widths and those fields read back as the same operands, which
// is where range limits, alignment, Align(PC, 4) and immediate rotation are enforced.
import type { Addr } from './address.js';
import { fieldsOf, rowFor } from './decode.js';
import { encode, fieldsFit } from './encode.js';
import type { Row } from './row.js';
import { rowOf, rowOrder } from './rows.js';
import type { Assembled, Fields, ParsedInsn } from './types.js';

/** Whether every operand both records name holds the same value. */
function agrees(derived: Fields, parsed: Fields): boolean {
  for (const key of Object.keys(derived)) {
    const value = parsed[key];
    if (value !== undefined && value !== derived[key]) {
      return false;
    }
  }
  return true;
}

/** The word `row` encodes the operands as at `addr`, or undefined when it cannot. */
export function encodeOperands(row: Row, operands: Fields, addr: Addr): number | undefined {
  const fields = row.fromOps(operands, addr);
  if (fields === undefined || !fieldsFit(row.spec, fields) || row.refuse(fields)) {
    return undefined;
  }
  const word = encode(row.spec, fields);
  // Read the word back: a field that overlaps bits the row fixes (rd = pc, pc in a list) must not
  // change what the text says.
  return agrees(row.toOps(fieldsOf(row, word), addr), operands) ? word : undefined;
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

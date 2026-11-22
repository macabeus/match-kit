// ARMv4T (ARM and Thumb, as on the ARM7TDMI): one instruction table behind a decoder, an encoder, a printer of
// GNU as unified syntax, a parser of that same text and an assembler.

// Decoded instructions and the tables' vocabulary.
export type { Addr, Mode } from './armv4t/address.js';
export type {
  Assembled,
  Field,
  FieldKind,
  Fields,
  Flow,
  FlowKind,
  Insn,
  InsnSpec,
  ParsedCandidate,
  ParsedInsn,
  RawReason,
  RegisterEffect,
  RegisterSpec,
  SpecId,
  SymbolResolver,
} from './armv4t/types.js';
export { RAW_REASONS } from './armv4t/types.js';
export { insnUnit } from './armv4t/address.js';
export { IsaInvariantError } from './armv4t/errors.js';

// Bytes to instructions, and back.
export { decode, isConditional, thumbWordAt } from './armv4t/decode.js';
export { encode } from './armv4t/encode.js';

// Instructions to text, and back.
export { format, formatDecoding, formatRaw } from './armv4t/text/format.js';
export { parse } from './armv4t/text/parse.js';
export { assemble } from './armv4t/assemble.js';
export { printing, rawReason, roundTrips } from './armv4t/printing-rule.js';
export type { Printing } from './armv4t/printing-rule.js';
export { CONDITIONS } from './armv4t/text/operand-text.js';

// What an instruction does.
export { effectOf, registerEffect } from './armv4t/registers.js';
export { pcOf, thumbPoolBase } from './armv4t/tables/pc-relative.js';
export { popcount } from './armv4t/bits.js';

// The tables, for a caller that reads rows instead of decoding: a scanner's prefilters, a table check.
export { ROWS, rowOf, rowOrder, specOf, specsOf } from './armv4t/tables/registry.js';
export type { Row } from './armv4t/tables/row.js';
export {
  fieldsOf,
  isThumbBlPrefix,
  isThumbBlSuffix,
  rowFor,
  thumbMayBranchShort,
  thumbMayName,
  thumbMayReachPcRelative,
} from './armv4t/decode.js';

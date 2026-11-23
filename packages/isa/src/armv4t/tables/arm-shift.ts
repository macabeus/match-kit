// ARM immediate shifts of a register operand (data processing and word/byte loads): the encoding
// stores lsr #32 and asr #32 as amount 0 and spells rrx as ror #0. Operand `shift` 0..3 is lsl, lsr,
// asr, ror and 4 is rrx; `amount` is the shift in bits as written.

/** The written shift of an encoded (type, amount) pair. */
export function shiftOperands(stype: number, imm5: number): { readonly shift: number; readonly amount: number } {
  if (stype === 0) {
    return { shift: 0, amount: imm5 };
  }
  if (stype === 3) {
    return imm5 === 0 ? { shift: 4, amount: 0 } : { shift: 3, amount: imm5 };
  }
  return { shift: stype, amount: imm5 === 0 ? 32 : imm5 };
}

/** The encoded (type, amount) pair of a written shift, or undefined when it has no encoding. */
export function shiftFields(
  shift: number,
  amount: number,
): { readonly stype: number; readonly imm5: number } | undefined {
  if (shift === 0) {
    return amount >= 0 && amount <= 31 ? { stype: 0, imm5: amount } : undefined;
  }
  if (shift === 1 || shift === 2) {
    return amount >= 1 && amount <= 32 ? { stype: shift, imm5: amount & 31 } : undefined;
  }
  if (shift === 3) {
    return amount >= 1 && amount <= 31 ? { stype: 3, imm5: amount } : undefined;
  }
  if (shift === 4) {
    return amount === 0 ? { stype: 3, imm5: 0 } : undefined;
  }
  return undefined;
}

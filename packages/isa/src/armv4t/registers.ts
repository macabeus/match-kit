// The register effect of a decoded instruction, read from what its row says it writes (RegisterSpec) over the
// instruction's operands, so a hi register (H:R3), a register list or a base written back reads as the row's
// syntax names it. Only what the instruction itself does is here: a call writes lr, and what the callee
// does to other registers is the caller's calling convention to add.
import { IsaInvariantError } from './errors.js';
import { rowOf } from './tables/registry.js';
import type { Insn, OperandName, Operands, RegisterEffect, RegisterSpec } from './types.js';

const NONE: RegisterEffect = { writes: 0, from: [] };

/**
 * The core registers `insn` writes (a bit per register; bit 15 is pc) and the registers the written value comes
 * from. An encoding that is no instruction writes nothing.
 */
export function registerEffect(insn: Insn): RegisterEffect {
  const row = rowOf(insn.specId);
  if (row.registers === undefined) {
    return NONE;
  }
  const operands = row.toOperands(insn.fields, insn.addr);
  return effectOf(row.registers(operands), operands, insn.specId);
}

/** The effect a RegisterSpec gives over a row's operands; a name the operands lack is a broken table, never r0. */
export function effectOf(spec: RegisterSpec, operands: Operands, specId: string): RegisterEffect {
  const valueOf = (name: OperandName): number => {
    const value = operands[name];
    if (value === undefined) {
      throw new IsaInvariantError(`${specId}: its RegisterSpec names '${name}', which is not one of its operands`);
    }
    return value;
  };
  let writes = spec.fixed ?? 0;
  for (const name of spec.writes ?? []) {
    writes |= 1 << valueOf(name);
  }
  if (spec.list !== undefined) {
    writes |= valueOf(spec.list);
  }
  return { writes, from: (spec.from ?? []).map(valueOf) };
}

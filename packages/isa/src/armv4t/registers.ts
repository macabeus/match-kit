// The register effect of a decoded instruction, read from its row's RegisterSpec (types.ts) over the
// instruction's operands, so a hi register (H:R3) or a register list reads as the row's syntax names it.
import { IsaInvariantError } from './errors.js';
import { rowOf } from './tables/registry.js';
import type { Fields, Insn, RegisterEffect, RegisterSpec } from './types.js';

const NONE: RegisterEffect = { writes: 0, from: [] };

/** What `insn` writes and where the written value comes from; nothing for a row without a RegisterSpec. */
export function registerEffect(insn: Insn): RegisterEffect {
  const row = rowOf(insn.specId);
  const spec = row.spec.registers;
  if (spec === undefined) {
    return NONE;
  }
  return effectOf(spec, row.toOps(insn.fields, insn.addr), insn.specId);
}

/** The effect a RegisterSpec gives over a row's operands; a name the operands lack is a broken table, never r0. */
export function effectOf(spec: RegisterSpec, ops: Fields, specId: string): RegisterEffect {
  const op = (name: string): number => {
    const value = ops[name];
    if (value === undefined) {
      throw new IsaInvariantError(`${specId}: its RegisterSpec names '${name}', which is not one of its operands`);
    }
    return value;
  };
  let writes = spec.fixed ?? 0;
  for (const name of spec.writes ?? []) {
    writes |= 1 << op(name);
  }
  if (spec.list !== undefined) {
    writes |= op(spec.list);
  }
  return { writes, from: (spec.from ?? []).map(op) };
}

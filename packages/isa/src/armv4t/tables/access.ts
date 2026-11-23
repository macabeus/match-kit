// The two readers the tables use. A row's raw bits and its operands are both records of numbers, and they are
// easy to confuse: `bits` reads a field the row declares and throws when it does not (a typo in a table, never a
// property of the bytes), `operand` reads an operand by one of the names the syntax templates know.
import { IsaInvariantError } from '../errors.js';
import type { Fields, OperandName, Operands } from '../types.js';

/** The raw value of the field `name`; throws when the row declares no such field. */
export function bits(fields: Fields, name: string): number {
  const value = fields[name];
  if (value === undefined) {
    throw new IsaInvariantError(`no field '${name}' among ${Object.keys(fields).join(', ') || 'none'}`);
  }
  return value;
}

/** The value of the operand `name`, 0 when the instruction has none. */
export function operand(operands: Operands, name: OperandName): number {
  return operands[name] ?? 0;
}

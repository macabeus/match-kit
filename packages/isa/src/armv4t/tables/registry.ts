// The registry over both tables: every row by id, in table order, and `specOf`.
import type { Mode } from '../address.js';
import { IsaInvariantError } from '../errors.js';
import type { InsnSpec, SpecId } from '../types.js';
import { ARM_ROWS } from './arm.js';
import type { Row } from './row.js';
import { THUMB_BL, THUMB_ROWS } from './thumb.js';

/** Every row of a mode in table order (Thumb: the 16-bit rows, then the bl pair). */
export const ROWS: Readonly<Record<Mode, readonly Row[]>> = {
  thumb: [...THUMB_ROWS, THUMB_BL],
  arm: ARM_ROWS,
};

const BY_ID: ReadonlyMap<SpecId, Row> = new Map([...ROWS.thumb, ...ROWS.arm].map((r) => [r.spec.id, r] as const));

/** The position of each row in its table, which breaks asPriority ties. */
const ORDER: ReadonlyMap<SpecId, number> = new Map([
  ...ROWS.thumb.map((r, i) => [r.spec.id, i] as const),
  ...ROWS.arm.map((r, i) => [r.spec.id, i] as const),
]);

if (BY_ID.size !== ROWS.thumb.length + ROWS.arm.length) {
  throw new IsaInvariantError('isa tables: duplicate row id');
}

/** The row of an id; throws on an id no table defines (a caller bug). */
export function rowOf(id: SpecId): Row {
  const found = BY_ID.get(id);
  if (found === undefined) {
    throw new IsaInvariantError(`unknown instruction spec '${id}'`);
  }
  return found;
}

/** The table row (InsnSpec) of an id. */
export function specOf(id: SpecId): InsnSpec {
  return rowOf(id).spec;
}

/** The table position of a row id. */
export function rowOrder(id: SpecId): number {
  return ORDER.get(id) ?? Number.MAX_SAFE_INTEGER;
}

/** Every InsnSpec of a mode, in table order. */
export function specsOf(mode: Mode): readonly InsnSpec[] {
  return ROWS[mode].map((r) => r.spec);
}

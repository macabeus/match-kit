// encode(spec, fields): packs raw field values into the row's match bits. Values are masked to their
// field width, so callers that need range checks (assemble) check before calling.
import type { Fields, InsnSpec } from './types.js';

/** The encoding of `fields` under `spec` (a Thumb bl: first halfword | second << 16). */
export function encode(spec: InsnSpec, fields: Fields): number {
  let word = spec.match >>> 0;
  for (const field of spec.fields) {
    const value = fields[field.name] ?? 0;
    word = (word | ((value & (2 ** field.width - 1)) << field.lo)) >>> 0;
  }
  return word;
}

/** Whether every field of `spec` is given an integer that fits its width. */
export function fieldsFit(spec: InsnSpec, fields: Fields): boolean {
  for (const field of spec.fields) {
    const value = fields[field.name];
    if (value === undefined || !Number.isInteger(value) || value < 0 || value >= 2 ** field.width) {
      return false;
    }
  }
  return true;
}

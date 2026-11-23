// ARM data-processing immediates: an 8-bit value rotated right by twice a 4-bit field. GNU as encodes
// `#value` with the smallest even left rotation that brings the value into 8 bits (tc-arm.c,
// encode_arm_immediate), so any other encoding of the same value needs the explicit `#imm8, rot` text.
import { rol32, ror32 } from '../bits.js';
import type { Operands } from '../types.js';

/** The value of a 12-bit rotated-immediate field. */
export function decodeArmImmediate(field: number): number {
  return ror32(field & 0xff, ((field >>> 8) & 0xf) * 2);
}

/** The 12-bit field GNU as picks for `#value`, or undefined when no rotation fits. */
export function encodeArmImmediate(value: number): number | undefined {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    return undefined;
  }
  for (let i = 0; i < 32; i += 2) {
    const a = rol32(value, i);
    if (a <= 0xff) {
      return a | (i << 7);
    }
  }
  return undefined;
}

/** Whether a 12-bit field is the encoding GNU as picks for its own value. */
export function isCanonicalArmImmediate(field: number): boolean {
  return encodeArmImmediate(decodeArmImmediate(field)) === field;
}

/** The `{const}` operand values of a 12-bit field: its value, rotation, and whether the text must spell the rotation. */
export function constOperands(field: number): Operands {
  return {
    imm: decodeArmImmediate(field),
    rot: ((field >>> 8) & 0xf) * 2,
    explicit: isCanonicalArmImmediate(field) ? 0 : 1,
  };
}

/** The 12-bit field of `{const}` operand values: GNU as's choice for `#v`, the given rotation for `#imm8, rot`. */
export function constField(o: Operands): number | undefined {
  const value = o.imm ?? 0;
  if (o.explicit !== 1) {
    return encodeArmImmediate(value);
  }
  const rot = o.rot ?? 0;
  const imm8 = rol32(value, rot);
  return imm8 > 0xff || rot % 2 !== 0 || rot > 30 ? undefined : ((rot / 2) << 8) | imm8;
}

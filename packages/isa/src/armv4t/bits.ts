// Bit arithmetic shared by the tables and the codecs: sign extension, rotation, popcount and the
// Align(PC, 4) of PC-relative Thumb forms, and the one accessor of a field record. All values are
// unsigned 32-bit unless a name says signed.
import type { Fields } from './types.js';

/** The `bits`-wide two's-complement value `v` as a signed number. */
export function sext(v: number, bits: number): number {
  const sign = 2 ** (bits - 1);
  return v >= sign ? v - 2 * sign : v;
}

/** `v` rotated right by `n` bits (0..31) as an unsigned 32-bit value. */
export function ror32(v: number, n: number): number {
  const s = n & 31;
  return s === 0 ? v >>> 0 : ((v >>> s) | (v << (32 - s))) >>> 0;
}

/** `v` rotated left by `n` bits (0..31) as an unsigned 32-bit value. */
export function rol32(v: number, n: number): number {
  return ror32(v, (32 - (n & 31)) & 31);
}

/** The number of set bits of a 32-bit value. */
export function popcount(v: number): number {
  let x = v >>> 0;
  let n = 0;
  while (x !== 0) {
    x &= x - 1;
    n++;
  }
  return n;
}

/** `a` rounded down to a multiple of 4: Align(PC, 4). */
export function align4(a: number): number {
  return a - (a % 4);
}

/** The value a field or operand record holds under `key`, 0 when it holds none. */
export function fieldValue(f: Fields, key: string): number {
  return f[key] ?? 0;
}

/** A 32-bit address wrapped into 0..2^32-1. */
export function wrap32(a: number): number {
  return ((a % 2 ** 32) + 2 ** 32) % 2 ** 32;
}

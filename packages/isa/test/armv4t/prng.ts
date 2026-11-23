// A fixed-seed xorshift32 generator (Marsaglia 2003, shifts 13, 17, 5): a seeded sample depends on its seed alone.

/** The first `count` values generated from `seed`, a nonzero unsigned 32-bit integer. */
export function prngSequence(seed: number, count: number): Uint32Array {
  const values = new Uint32Array(count);
  let x = seed >>> 0;
  for (let i = 0; i < count; i++) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    values[i] = x;
  }
  return values;
}

// Addresses and the two instruction sets: the vocabulary every module here shares.

/** A 32-bit address, as an unsigned number. */
export type Addr = number;

/** The two instruction sets of ARMv4T. */
export type Mode = 'thumb' | 'arm';

/** The size of one instruction of `mode` (a Thumb `bl` pair is two), and the alignment every instruction of it keeps. */
export function insnUnit(mode: Mode): 2 | 4 {
  return mode === 'arm' ? 4 : 2;
}

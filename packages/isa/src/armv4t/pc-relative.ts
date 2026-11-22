// The PC-relative operand codecs shared by the tables: branch offsets, Thumb Align(PC, 4) loads and
// the ARM pc + 8 base. A target is a wrapped 32-bit address; encoding works on the exact difference
// between the target and the PC, as GNU as resolves a label defined in the same section.
import type { Addr } from './address.js';
import { align4, sext, wrap32 } from './bits.js';

/** The PC an instruction at `addr` reads: addr + 4 in Thumb, addr + 8 in ARM. */
export function pcOf(addr: Addr, mode: 'thumb' | 'arm'): number {
  return addr + (mode === 'thumb' ? 4 : 8);
}

/** The target of a signed `width`-bit offset field counted in units of `scale` bytes from `pc`. */
export function branchTarget(pc: number, offset: number, width: number, scale: number): Addr {
  return wrap32(pc + sext(offset, width) * scale);
}

/** The `width`-bit offset field reaching `target` from `pc` in units of `scale`, or undefined. */
export function branchOffset(pc: number, target: number, width: number, scale: number): number | undefined {
  const diff = target - pc;
  if (diff % scale !== 0) {
    return undefined;
  }
  const units = diff / scale;
  const half = 2 ** (width - 1);
  if (units < -half || units >= half) {
    return undefined;
  }
  return units < 0 ? units + 2 * half : units;
}

/** The base of Thumb `ldr rd, [pc, #imm]` and `add rd, pc, #imm`: Align(addr + 4, 4). */
export function thumbPoolBase(addr: Addr): number {
  return align4(addr + 4);
}

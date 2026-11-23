// A row's flow class plus its operands and address gives the instruction's Flow (the table in types.ts,
// FlowClass). The conventions:
//   bx         bx lr returns; Thumb bx pc switches to ARM at Align(addr + 4, 4) (instruction fetch is
//              word-aligned); any other register is an indirect jump.
//   load-pc    pc loaded from memory: a return when the base is sp (pop, ldmia sp!, ldr pc, [sp], #4),
//              otherwise an indirect jump through the base register (pc: a pc-relative table read such as
//              `ldr pc, [pc, r0, lsl #2]`).
//   pool-load  a literal-pool load; with rd pc (`ldr pc, [pc, #imm]`) it transfers control to the loaded
//              word, so a walker reads rd before treating it as a fall-through.
//   mov-pc     a data-processing write to pc: `mov pc, lr` (no shift, no other operand) returns; anything
//              else is an indirect jump through rm (or rn for an immediate operand).
//   add-pc     `add pc, ...`: an indirect jump (jump tables).
//   branch     unconditional in Thumb; conditional in ARM when the condition is not al.
import type { Addr, Mode } from './address.js';
import { align4 } from './bits.js';
import { COND_AL, LR, PC, SP } from './names.js';
import { operand } from './tables/access.js';
import { pcOf } from './tables/pc-relative.js';
import type { Flow, FlowClass, Operands } from './types.js';

/** The register a data-processing write to pc jumps through: rm, or rn when the second operand is an immediate. */
function jumpRegister(o: Operands): number {
  return o.rm ?? o.rn ?? PC;
}

/** `mov pc, lr` and nothing more: no first operand, no shift. */
function isPlainMoveOfLr(o: Operands): boolean {
  const unshifted = o.rs === undefined && operand(o, 'shift') === 0 && operand(o, 'amount') === 0;
  return o.rn === undefined && unshifted && o.rm === LR;
}

/** The Flow of an instruction of class `flowClass` with operands `o` at `addr`. */
export function flowOf(flowClass: FlowClass, mode: Mode, o: Operands, addr: Addr): Flow {
  switch (flowClass) {
    case 'next':
    case 'bl-prefix':
      return { kind: 'next' };
    case 'branch':
      return {
        kind: 'branch',
        target: operand(o, 'target'),
        conditional: mode === 'arm' && operand(o, 'cond') !== COND_AL,
      };
    case 'cond-branch':
      return { kind: 'branch', target: operand(o, 'target'), conditional: true };
    case 'bl':
      return { kind: 'call', target: operand(o, 'target') };
    case 'bx': {
      const rm = operand(o, 'rm');
      if (rm === LR) {
        return { kind: 'return', via: 'bx-lr' };
      }
      if (rm === PC && mode === 'thumb') {
        return { kind: 'mode-switch', target: align4(pcOf(addr, 'thumb')) };
      }
      return { kind: 'indirect', reg: rm, via: 'bx' };
    }
    case 'load-pc':
      // A pop names no base: it is sp's.
      return o.rn === undefined || o.rn === SP
        ? { kind: 'return', via: 'pop-pc' }
        : { kind: 'indirect', reg: o.rn, via: 'load-pc' };
    case 'mov-pc':
      return isPlainMoveOfLr(o)
        ? { kind: 'return', via: 'mov-pc-lr' }
        : { kind: 'indirect', reg: jumpRegister(o), via: 'mov-pc' };
    case 'add-pc':
      return { kind: 'indirect', reg: jumpRegister(o), via: 'add-pc' };
    case 'pool-load':
      return { kind: 'pool-load', pool: operand(o, 'target'), rd: operand(o, 'rd') };
    case 'adr':
      return { kind: 'adr', target: operand(o, 'target') };
    case 'swi':
      return { kind: 'interrupt', imm: operand(o, 'imm') };
    case 'bl-suffix':
      return { kind: 'indirect', reg: LR, via: 'bl-suffix' };
    case 'invalid':
      return { kind: 'invalid' };
  }
}

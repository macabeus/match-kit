// A row's FlowKind plus its operand values and address gives the instruction's Flow. The conventions:
//   bx       bx lr returns; Thumb bx pc switches to ARM at Align(addr + 4, 4) (instruction fetch is
//            word-aligned); any other register is an indirect jump.
//   pop-pc   pc loaded from memory: a return when the base is sp (pop, ldmia sp!, ldr pc, [sp], #4),
//            otherwise an indirect jump via 'load-pc' through the base register (15: a pc-relative
//            table read such as `ldr pc, [pc, r0, lsl #2]`).
//   pc-load  a literal-pool load; with rd 15 (`ldr pc, [pc, #imm]`) it transfers control to the
//            loaded word, so a walker reads rd before treating it as a fall-through.
//   mov-pc   a data-processing write to pc: `mov pc, lr` (no shift, no other operand) returns;
//            anything else is an indirect jump through rm (or rn for an immediate operand).
//   add-pc   `add pc, ...`: an indirect jump (jump tables).
//   branch   unconditional in Thumb; conditional in ARM when the condition is not al.
import type { Addr, Mode } from './address.js';
import { align4, fieldValue as op } from './bits.js';
import { pcOf } from './pc-relative.js';
import type { Fields, Flow, FlowKind } from './types.js';

function indirectReg(ops: Fields): number {
  return ops['rm'] ?? ops['rn'] ?? 15;
}

/** The Flow of an instruction of class `kind` with operand values `ops` at `addr`. */
export function flowOf(kind: FlowKind, mode: Mode, ops: Fields, addr: Addr): Flow {
  switch (kind) {
    case 'next':
      return { kind: 'next' };
    case 'branch':
      return { kind: 'branch', target: op(ops, 'target'), conditional: mode === 'arm' && op(ops, 'cond') !== 14 };
    case 'cond-branch':
      return { kind: 'branch', target: op(ops, 'target'), conditional: true };
    case 'bl':
      return { kind: 'bl', target: op(ops, 'target') };
    case 'bx': {
      const rm = op(ops, 'rm');
      if (rm === 14) {
        return { kind: 'return', via: 'bx-lr' };
      }
      if (rm === 15 && mode === 'thumb') {
        return { kind: 'mode-switch', target: align4(pcOf(addr, 'thumb')) };
      }
      return { kind: 'indirect', reg: rm, via: 'bx' };
    }
    case 'pop-pc': {
      const rn = ops['rn'];
      return rn === undefined || rn === 13
        ? { kind: 'return', via: 'pop-pc' }
        : { kind: 'indirect', reg: rn, via: 'load-pc' };
    }
    case 'mov-pc': {
      const plain =
        ops['rn'] === undefined && ops['rs'] === undefined && op(ops, 'shift') === 0 && op(ops, 'amount') === 0;
      if (plain && ops['rm'] === 14) {
        return { kind: 'return', via: 'mov-pc-lr' };
      }
      return { kind: 'indirect', reg: indirectReg(ops), via: 'mov-pc' };
    }
    case 'add-pc':
      return { kind: 'indirect', reg: indirectReg(ops), via: 'add-pc' };
    case 'pc-load':
      return { kind: 'pool-load', pool: op(ops, 'target'), rd: op(ops, 'rd') };
    case 'adr':
      return { kind: 'adr', target: op(ops, 'target') };
    case 'swi':
      return { kind: 'swi', imm: op(ops, 'imm') };
    case 'invalid':
      return { kind: 'invalid' };
  }
}

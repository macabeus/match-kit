// A scripted stand-in for the objdiff engine, for cases only a script produces: rows past one side's
// end, the precedence of two sides' kinds, an undecoded row that differs, another engine version.
// It implements the calls `createScorer` makes.
import type * as ObjdiffWasm from 'objdiff-wasm';

import type { Engine } from '../src/index.js';

type Kind = ObjdiffWasm.display.InstructionDiffKind;

export interface FakeSide {
  /** One kind per row this side displays. */
  rows: Kind[];
  /** Rows that do not decode as an instruction. */
  undecoded?: number[];
}

export interface FakeScript {
  target: FakeSide;
  candidate: FakeSide;
  version?: string;
}

const handle = <T extends object>(value: T) => Object.assign(value, { [Symbol.dispose]() {} });

export function fakeEngine(script: FakeScript): Engine {
  const side = (od: { side: 'target' | 'candidate' }) => script[od.side];
  const engine = {
    version: () => script.version ?? '3.8.1',
    diff: {
      DiffConfig: class {
        setProperty() {}
        [Symbol.dispose]() {}
      },
      Object: { parse: () => handle({}) },
      runDiff: () => ({
        left: handle({ side: 'target' as const, findSymbol: () => ({ id: 0 }) }),
        right: handle({ side: 'candidate' as const, findSymbol: () => ({ id: 0 }) }),
      }),
    },
    display: {
      displaySymbol: (od: { side: 'target' | 'candidate' }) => ({ rowCount: side(od).rows.length }),
      displayInstructionRow(od: { side: 'target' | 'candidate' }, _id: number, row: number) {
        const s = side(od);
        const mnemonic = s.undecoded?.includes(row) ? '<illegal>' : 'nop';
        return {
          diffKind: s.rows[row],
          segments: [{ text: { tag: 'opcode', val: { mnemonic, opcode: 0 } }, color: { tag: 'normal' }, padTo: 0 }],
        };
      },
    },
  };
  return engine as unknown as Engine;
}

/** Any bytes: the fake engine parses everything. */
export const BYTES = new Uint8Array([0x7f, 0x45, 0x4c, 0x46]);

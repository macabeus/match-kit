// A scripted stand-in for the objdiff engine, for cases only a script produces: rows past one side's
// end, the precedence of two sides' kinds, a trap mid-walk, an engine that dies. It implements the
// calls `createScorer` makes.
import type * as ObjdiffWasm from 'objdiff-wasm';

import type { Engine } from '../src/index.js';
import { PROBE_OBJECT_BASE64 } from '../src/scorer/probe-object.js';

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
  /** The row whose display traps, as the engine panicking would. */
  trapAt?: { side: 'target' | 'candidate'; row: number };
  /** Whether the engine still parses its probe object after a trap. */
  healthy?: () => boolean;
  /** Make `DiffConfig.setProperty` refuse every property. */
  rejectSettings?: boolean;
}

const probe = Uint8Array.from(atob(PROBE_OBJECT_BASE64), (c) => c.charCodeAt(0));
const isProbe = (bytes: Uint8Array) => bytes.length === probe.length && bytes.every((b, i) => b === probe[i]);
const trap = () =>
  new (globalThis as unknown as { WebAssembly: { RuntimeError: new (m: string) => Error } }).WebAssembly.RuntimeError(
    'unreachable',
  );
const handle = <T extends object>(value: T) => Object.assign(value, { [Symbol.dispose]() {} });

export function fakeEngine(script: FakeScript): Engine {
  const side = (od: { side: 'target' | 'candidate' }) => script[od.side];
  const engine = {
    version: () => script.version ?? '3.8.1',
    diff: {
      DiffConfig: class {
        setProperty() {
          if (script.rejectSettings) {
            throw new Error('Invalid property key');
          }
        }
        [Symbol.dispose]() {}
      },
      Object: {
        parse(bytes: Uint8Array, _config: unknown, which: string) {
          if (isProbe(bytes)) {
            if (script.healthy && !script.healthy()) {
              throw trap();
            }
            return handle({ side: 'target' as const });
          }
          return handle({ side: which === 'target' ? ('target' as const) : ('candidate' as const) });
        },
      },
      runDiff: () => ({
        left: handle({ side: 'target' as const, findSymbol: () => ({ id: 0 }) }),
        right: handle({ side: 'candidate' as const, findSymbol: () => ({ id: 0 }) }),
      }),
    },
    display: {
      displaySymbol: (od: { side: 'target' | 'candidate' }) => ({ rowCount: side(od).rows.length }),
      displayInstructionRow(od: { side: 'target' | 'candidate' }, _id: number, row: number) {
        if (script.trapAt && script.trapAt.side === od.side && script.trapAt.row === row) {
          throw trap();
        }
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

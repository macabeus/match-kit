// Fails closed: every engine failure throws, since a swallowed error could report a false
// byte-exact match.
import { loadEngine } from '#engine';
import type * as ObjdiffWasm from 'objdiff-wasm';

import type {
  DiffBreakdown,
  Engine,
  InspectedRow,
  MatchScore,
  RowKind,
  Scorer,
  ScorerOptions,
  Target,
} from '../types.js';
import { call, disposeAll, hold, release } from './engine-guard.js';
import { SymbolNotFoundError, UndiffableError } from './errors.js';
import { rowText } from './row-text.js';

/** A row that did not decode as an instruction: objdiff shows it as `<illegal>` and diffs it as `none`. */
const isUndecoded = (row: ObjdiffWasm.display.InstructionDiffRow | null): boolean =>
  row !== null && row.segments.some((s) => s.text.tag === 'opcode' && s.text.val.mnemonic === '<illegal>');

const KINDS: Record<ObjdiffWasm.display.InstructionDiffKind, RowKind> = {
  none: 'none',
  insert: 'insert',
  delete: 'delete',
  replace: 'replace',
  'op-mismatch': 'opMismatch',
  'arg-mismatch': 'argMismatch',
};

const MAPPING = { mappings: [], selectingLeft: undefined, selectingRight: undefined };

/** A target's engine handle, kept out of the public `Target` type. */
interface ParsedTarget extends Target {
  readonly object: ObjdiffWasm.diff.Object;
  readonly owner: object;
  disposed: boolean;
}

/** A scorer over the objdiff engine, which loads once per process or worker. */
export async function createScorer(options: ScorerOptions = {}): Promise<Scorer> {
  return createScorerFor(await loadEngine(), options);
}

/** A scorer over `engine`. */
export function createScorerFor(engine: Engine, options: ScorerOptions = {}): Scorer {
  const settings = Object.entries(options.diffSettings ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const configKey = settings.length === 0 ? '' : JSON.stringify(settings);
  const config = call(engine, () => new engine.diff.DiffConfig(), 'the engine could not create a DiffConfig', Error);
  for (const [key, value] of settings) {
    try {
      config.setProperty(key, value);
    } catch (cause) {
      disposeAll(config);
      throw new Error(`invalid diffSettings: ${key} = ${JSON.stringify(value)}`, { cause });
    }
  }
  const heldConfig = hold(engine, config);
  const owner = {};
  let disposed = false;
  const live = (): void => {
    if (disposed) {
      throw new Error('this scorer was disposed');
    }
  };

  const parsed = (target: Target): ParsedTarget => {
    const t = target as ParsedTarget;
    if (t.owner !== owner) {
      throw new Error('this target was parsed by another scorer');
    }
    if (t.disposed) {
      throw new Error('this target was disposed');
    }
    return t;
  };

  // Shared by `score` and `inspect`, so both count the same way.
  const walk = (
    target: Target,
    candidateBytes: Uint8Array,
    symbol: string,
    onRow?: (row: number, kind: RowKind, target: string | null, candidate: string | null) => void,
  ): MatchScore => {
    live();
    const t = parsed(target);
    let candidate: ObjdiffWasm.diff.Object | undefined;
    let left: ObjdiffWasm.diff.ObjectDiff | undefined;
    let right: ObjdiffWasm.diff.ObjectDiff | undefined;
    try {
      candidate = call(
        engine,
        () => engine.diff.Object.parse(candidateBytes, config, 'base'),
        'the candidate object could not be parsed',
      );
      const c = candidate;

      // Left is the target and right the candidate, as objdiff's own UI lays them out.
      ({ left, right } = call(
        engine,
        () => engine.diff.runDiff(t.object, c, config, MAPPING),
        'objdiff could not diff the two objects',
      ));
      if (!left || !right) {
        throw new UndiffableError('objdiff runDiff returned an empty side');
      }
      const l0 = left;
      const r0 = right;

      const find = (od: ObjdiffWasm.diff.ObjectDiff, side: 'target' | 'candidate') => {
        const s = od.findSymbol(symbol, undefined);
        if (!s) {
          throw new SymbolNotFoundError(symbol, side);
        }
        return s;
      };
      const lSym = find(l0, 'target');
      const rSym = find(r0, 'candidate');
      const displaySymbol = (od: ObjdiffWasm.diff.ObjectDiff, id: number) =>
        call(engine, () => engine.display.displaySymbol(od, id), `symbol '${symbol}' could not be displayed`);
      const lDisp = displaySymbol(l0, lSym.id);
      const rDisp = displaySymbol(r0, rSym.id);
      const rows = Math.max(lDisp.rowCount, rDisp.rowCount);
      // A symbol with no rows would fall through the loop with no differences, a spurious match.
      if (rows === 0) {
        throw new UndiffableError(`symbol '${symbol}' has no instruction rows to diff`);
      }

      const breakdown: DiffBreakdown = { insert: 0, delete: 0, replace: 0, opMismatch: 0, argMismatch: 0 };
      let matching = 0;
      let differences = 0;

      for (let row = 0; row < rows; row++) {
        // A row past a side's rowCount is padding for the other side's insertions.
        const display = (od: ObjdiffWasm.diff.ObjectDiff, s: ObjdiffWasm.diff.SymbolInfo, count: number) => {
          if (row >= count) {
            return null;
          }
          return call(
            engine,
            () => engine.display.displayInstructionRow(od, s.id, row, config),
            `row ${row} of '${symbol}' could not be displayed`,
          );
        };
        // Both sides are displayed on every row, though only one kind is read: displaying a row is
        // how the scorer learns the engine can decode it.
        const l = display(l0, lSym, lDisp.rowCount);
        const r = display(r0, rSym, rDisp.rowCount);
        const lk = KINDS[l?.diffKind ?? 'none'];
        const kind = lk !== 'none' ? lk : KINDS[r?.diffKind ?? 'none'];
        // objdiff diffs two undecoded rows as `none` whatever their bytes (every row of a Thumb
        // object under `arm.archVersion: v4`), so such a row cannot count as a match. An undecoded
        // row that differs is counted as usual.
        if (kind === 'none' && (isUndecoded(l) || isUndecoded(r))) {
          throw new UndiffableError(
            `row ${row} of '${symbol}' does not decode as an instruction on either side, so it cannot be compared; check diffSettings (the architecture version, for instance)`,
          );
        }
        if (kind === 'none') {
          matching++;
        } else {
          differences++;
          breakdown[kind]++;
        }
        onRow?.(row, kind, l && rowText(l), r && rowText(r));
      }

      return Object.freeze({
        symbol,
        rows,
        matching,
        score: differences,
        match: differences === 0,
        breakdown: Object.freeze(breakdown),
      });
    } finally {
      // The target and the config outlive the call; every handle minted here is released.
      disposeAll(left, right, candidate);
    }
  };

  return {
    configKey,

    parseTarget(bytes) {
      live();
      const object = call(
        engine,
        () => engine.diff.Object.parse(bytes, config, 'target'),
        'the target object could not be parsed',
      );
      const held = hold(engine, object);
      const target: ParsedTarget = {
        object,
        owner,
        disposed: false,
        dispose() {
          if (!target.disposed) {
            target.disposed = true;
            release(engine, held);
          }
        },
      };
      return target;
    },

    score: (target, candidate, symbol) => walk(target, candidate, symbol),

    inspect(target, candidate, symbol) {
      const rows: InspectedRow[] = [];
      const score = walk(target, candidate, symbol, (row, kind, t, c) =>
        rows.push({ row, kind, target: t, candidate: c }),
      );
      return { score, rows };
    },

    dispose() {
      if (!disposed) {
        disposed = true;
        release(engine, heldConfig);
      }
    },
  };
}

// @matchkit/scoring — score a compiled candidate against a target object with the objdiff engine.
//
// This module runs anywhere: no `node:` import and no `Bun.*` API. `loadEngine` is the one piece
// that differs per runtime, and the package's `#engine` import map picks it.
//
// FAIL-CLOSED: nothing here is caught and turned into a number. Any engine failure throws, and a
// row that cannot be displayed can never count as matched — a swallowed error could report a false
// byte-exact match, the worst defect a scorer can have.
import type * as ObjdiffWasm from 'objdiff-wasm';

import type { Engine } from './engine.js';
import { rowText } from './row-text.js';

export type { Engine } from './engine.js';
export { loadEngine } from '#engine';
export { OBJDIFF_VERSION } from './version.js';
export { rowText } from './row-text.js';

/** How many differing rows fell into each of objdiff's kinds. They sum to `MatchScore.score`. */
export interface DiffBreakdown {
  insert: number;
  delete: number;
  replace: number;
  opMismatch: number;
  argMismatch: number;
}

export interface MatchScore {
  symbol: string;
  /** differing instruction rows; 0 is a byte-exact match */
  score: number;
  match: boolean;
  /** rows in this candidate's alignment against the target: the scale `score` is measured on */
  rows: number;
  matching: number;
  breakdown: DiffBreakdown;
}

/** The kind a differing row is counted under, or `none` for a row that matches. */
export type RowKind = keyof DiffBreakdown | 'none';

/** One side's symbol is missing from its object. */
export class SymbolNotFoundError extends Error {
  readonly symbol: string;
  readonly side: 'target' | 'candidate';

  constructor(symbol: string, side: 'target' | 'candidate') {
    super(`symbol '${symbol}' not found in ${side} object`);
    this.name = 'SymbolNotFoundError';
    this.symbol = symbol;
    this.side = side;
  }
}

/** The engine could not diff the pair: an object it cannot parse, a row it cannot display, a symbol with no rows. */
export class UndiffableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'UndiffableError';
  }
}

export interface ScorerOptions {
  /**
   * objdiff `DiffConfig` properties, as `DiffConfig.setProperty` takes them. Absent, the config is
   * objdiff's default. A setting changes what a diff counts, so it belongs in every cache key next
   * to `OBJDIFF_VERSION` — that is what `Scorer.configKey` is for.
   */
  diffSettings?: Readonly<Record<string, string>>;
}

/** A parsed target object, reused across every candidate scored against it. */
export interface Target {
  /** release the engine handle; the target cannot be scored against afterwards */
  dispose(): void;
}

/** One row of a scored pair, rendered as text. A side past its own rows is `null`. */
export interface InspectedRow {
  row: number;
  kind: RowKind;
  target: string | null;
  candidate: string | null;
}

/** A score together with every row it was counted from. */
export interface Inspection {
  score: MatchScore;
  rows: readonly InspectedRow[];
}

export interface Scorer {
  /** '' for objdiff's default config, else a stable spelling of `diffSettings` */
  readonly configKey: string;
  parseTarget(bytes: Uint8Array): Target;
  /** Score `candidate` against `target` for one symbol. The result is frozen. */
  score(target: Target, candidate: Uint8Array, symbol: string): MatchScore;
  /** The same score, plus each row's text: what a report or a prompt shows. */
  inspect(target: Target, candidate: Uint8Array, symbol: string): Inspection;
  /** release the config; every target this scorer parsed must be disposed too */
  dispose(): void;
}

const KINDS: Record<ObjdiffWasm.display.InstructionDiffKind, RowKind> = {
  none: 'none',
  insert: 'insert',
  delete: 'delete',
  replace: 'replace',
  'op-mismatch': 'opMismatch',
  'arg-mismatch': 'argMismatch',
};

// The engine's handles are component-model RESOURCES. Without an explicit dispose they wait on the
// FinalizationRegistry, which a tight synchronous scoring loop never lets run: after a few hundred
// calls the wasm side exhausts and panics, and the poisoned instance then fails every later call
// in the process. Disposal is the fix, not a nicety.
// The key is the one the engine binds: its jco output uses Symbol.dispose with a Symbol.for
// fallback on runtimes that predate it, and using only Symbol.dispose would silently no-op there.
const DISPOSE: typeof Symbol.dispose = Symbol.dispose ?? (Symbol.for('dispose') as never);
const disposeAll = (...handles: unknown[]): void => {
  for (const handle of handles) {
    (handle as { [DISPOSE]?: () => void } | undefined)?.[DISPOSE]?.();
  }
};

const MAPPING = { mappings: [], selectingLeft: undefined, selectingRight: undefined };

/** A target's engine handle, kept out of the public `Target` type. */
interface ParsedTarget extends Target {
  readonly object: ObjdiffWasm.diff.Object;
  readonly owner: object;
  disposed: boolean;
}

export function createScorer(engine: Engine, options: ScorerOptions = {}): Scorer {
  const settings = Object.entries(options.diffSettings ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const configKey = settings.length === 0 ? '' : JSON.stringify(settings);
  const config = new engine.diff.DiffConfig();
  for (const [key, value] of settings) {
    config.setProperty(key, value);
  }
  const owner = {};

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

  /** The one row walk `score` and `inspect` share, so the two can never count differently. */
  const walk = (
    target: Target,
    candidateBytes: Uint8Array,
    symbol: string,
    onRow?: (row: number, kind: RowKind, target: string | null, candidate: string | null) => void,
  ): MatchScore => {
    const t = parsed(target);
    let candidate, left, right;
    try {
      try {
        candidate = engine.diff.Object.parse(candidateBytes, config, 'base');
      } catch (cause) {
        throw new UndiffableError('the candidate object could not be parsed', { cause });
      }

      // left = target, right = candidate, as objdiff's own UI lays them out
      ({ left, right } = engine.diff.runDiff(t.object, candidate, config, MAPPING));
      if (!left || !right) {
        throw new UndiffableError('objdiff runDiff returned an empty side');
      }

      const find = (od: ObjdiffWasm.diff.ObjectDiff, side: 'target' | 'candidate') => {
        const s = od.findSymbol(symbol, undefined);
        if (!s) {
          throw new SymbolNotFoundError(symbol, side);
        }
        return s;
      };
      const lSym = find(left, 'target');
      const rSym = find(right, 'candidate');
      const lDisp = engine.display.displaySymbol(left, lSym.id);
      const rDisp = engine.display.displaySymbol(right, rSym.id);
      const rows = Math.max(lDisp.rowCount, rDisp.rowCount);
      // A symbol with no rows would fall through the loop with no differences, a spurious match.
      if (rows === 0) {
        throw new UndiffableError(`symbol '${symbol}' has no instruction rows to diff`);
      }

      const breakdown: DiffBreakdown = { insert: 0, delete: 0, replace: 0, opMismatch: 0, argMismatch: 0 };
      let matching = 0;
      let differences = 0;

      for (let row = 0; row < rows; row++) {
        // A row past a side's own rowCount is that side's padding for the other side's insertions:
        // `null` here is a fact, not a swallowed error.
        const display = (od: ObjdiffWasm.diff.ObjectDiff, s: ObjdiffWasm.diff.SymbolInfo, count: number) => {
          if (row >= count) {
            return null;
          }
          try {
            return engine.display.displayInstructionRow(od, s.id, row, config);
          } catch (cause) {
            throw new UndiffableError(`row ${row} of '${symbol}' could not be displayed`, { cause });
          }
        };
        // BOTH sides are displayed on every row, though only one kind is read: displaying a row is
        // how the scorer learns the engine can decode it. Consulting the candidate only where the
        // target's row said `none` would turn an engine refusal of the candidate into a score.
        const l = display(left, lSym, lDisp.rowCount);
        const r = display(right, rSym, rDisp.rowCount);
        const lk = KINDS[l?.diffKind ?? 'none'];
        const kind = lk !== 'none' ? lk : KINDS[r?.diffKind ?? 'none'];
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
      // the target and the config outlive the call by design; everything minted here does not
      disposeAll(left, right, candidate);
    }
  };

  return {
    configKey,

    parseTarget(bytes) {
      let object: ObjdiffWasm.diff.Object;
      try {
        object = engine.diff.Object.parse(bytes, config, 'target');
      } catch (cause) {
        throw new UndiffableError('the target object could not be parsed', { cause });
      }
      const target: ParsedTarget = {
        object,
        owner,
        disposed: false,
        dispose() {
          if (!target.disposed) {
            target.disposed = true;
            disposeAll(object);
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
      disposeAll(config);
    },
  };
}

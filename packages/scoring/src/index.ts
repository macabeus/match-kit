// @matchkit/scoring — score a compiled candidate against a target object with the objdiff engine.
//
// This module runs anywhere: no `node:` import and no `Bun.*` API. `loadEngine` is the one piece
// that differs per runtime, and the package's `#engine` import map picks it.
//
// Fails closed: every engine failure throws and is never turned into a number, since a swallowed
// error could report a false byte-exact match.
import type * as ObjdiffWasm from 'objdiff-wasm';

import type { Engine } from './engine.js';
import { PROBE_OBJECT_BASE64 } from './probe-object.js';
import { rowText } from './row-text.js';
import { OBJDIFF_VERSION } from './version.js';

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
  /** Differing instruction rows; 0 is a byte-exact match. */
  score: number;
  match: boolean;
  /** Rows in this candidate's alignment against the target: the scale `score` is measured on. */
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

/**
 * The engine could not diff this pair: an object it cannot parse, a row it cannot display or decode,
 * a symbol with no rows. The next pair may still score.
 */
export class UndiffableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'UndiffableError';
  }
}

/**
 * The engine failed and cannot score again in this process: each panic leaks engine memory, and
 * after a few thousand the engine fails every call. Every later call throws this too; restart the
 * process.
 */
export class EngineFailedError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('the objdiff engine failed and cannot score again in this process', options);
    this.name = 'EngineFailedError';
  }
}

export interface ScorerOptions {
  /**
   * objdiff `DiffConfig` properties, as `DiffConfig.setProperty` takes them; absent, objdiff's
   * default. A setting changes what a diff counts, so `Scorer.configKey` belongs in every cache key
   * next to `OBJDIFF_VERSION`.
   */
  diffSettings?: Readonly<Record<string, string>>;
}

/** A parsed target object, reused across every candidate scored against it. */
export interface Target {
  /** Release the engine handle; the target cannot be scored against afterwards. */
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

/** Scores candidates against targets under one `DiffConfig`. Made by `createScorer`. */
export interface Scorer {
  /** `''` for objdiff's default config, else a stable spelling of `diffSettings`. */
  readonly configKey: string;
  /** Parse a target object once, to score many candidates against. */
  parseTarget(bytes: Uint8Array): Target;
  /** Score `candidate` against `target` for one symbol. The result is frozen. */
  score(target: Target, candidate: Uint8Array, symbol: string): MatchScore;
  /** The same score, plus each row's text. */
  inspect(target: Target, candidate: Uint8Array, symbol: string): Inspection;
  /** Release the config; every target this scorer parsed must be disposed too. */
  dispose(): void;
}

/** Engines that failed: shared by every scorer made from them, since they share the wasm instance. */
const failedEngines = new WeakSet<Engine>();

/**
 * The handles that outlive one call (each scorer's config, each parsed target), per engine, held
 * weakly. An undisposed handle is dropped by the engine's FinalizationRegistry when collected, and
 * on a failed engine that drop traps outside any caller, as an uncaught exception. So when an
 * engine fails, every handle still held here is released at once.
 */
const heldHandles = new WeakMap<Engine, Set<WeakRef<object>>>();

function hold(engine: Engine, handle: object): WeakRef<object> {
  const ref = new WeakRef(handle);
  let held = heldHandles.get(engine);
  if (!held) {
    held = new Set();
    heldHandles.set(engine, held);
  }
  held.add(ref);
  return ref;
}

function fail(engine: Engine): void {
  failedEngines.add(engine);
  const held = heldHandles.get(engine);
  heldHandles.delete(engine);
  for (const ref of held ?? []) {
    disposeAll(ref.deref());
  }
}

// `WebAssembly` is global in every supported runtime, but no type library here declares it without
// the DOM.
const RuntimeError = (globalThis as { WebAssembly?: { RuntimeError?: abstract new () => Error } }).WebAssembly
  ?.RuntimeError;

let probeBytes: Uint8Array | undefined;

/** Whether the engine can still parse an object it is known to parse. */
function engineIsHealthy(engine: Engine): boolean {
  probeBytes ??= Uint8Array.from(atob(PROBE_OBJECT_BASE64), (c) => c.charCodeAt(0));
  let config, object;
  try {
    config = new engine.diff.DiffConfig();
    object = engine.diff.Object.parse(probeBytes, config, 'target');
    return true;
  } catch {
    return false;
  } finally {
    disposeAll(object, config);
  }
}

/**
 * Run one engine call. A wasm trap is the engine panicking: if the engine still works afterwards the
 * input is to blame and a `Failure` naming `what` is thrown, otherwise the engine is marked failed
 * for good. Any other throw is the input's fault. The engine's reason goes into the message, since
 * most callers print only the message.
 */
function call<T>(
  engine: Engine,
  fn: () => T,
  what: string,
  Failure: new (message: string, options: ErrorOptions) => Error = UndiffableError,
): T {
  if (failedEngines.has(engine)) {
    throw new EngineFailedError();
  }
  try {
    return fn();
  } catch (cause) {
    if (cause instanceof SymbolNotFoundError || cause instanceof UndiffableError) {
      throw cause;
    }
    if (RuntimeError !== undefined && cause instanceof RuntimeError && !engineIsHealthy(engine)) {
      fail(engine);
      throw new EngineFailedError({ cause });
    }
    throw new Failure(`${what}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
}

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

// The engine's handles are component-model resources. Without an explicit dispose they wait on the
// FinalizationRegistry, which a synchronous scoring loop never lets run, until the wasm side
// exhausts and panics and the instance fails every later call in the process.
// The key is the one the engine binds: its jco output falls back to `Symbol.for('dispose')` where
// `Symbol.dispose` is missing, and `Symbol.dispose` alone would silently no-op there.
const DISPOSE: typeof Symbol.dispose = Symbol.dispose ?? (Symbol.for('dispose') as never);
const disposeAll = (...handles: unknown[]): void => {
  for (const handle of handles) {
    try {
      (handle as { [DISPOSE]?: () => void } | undefined)?.[DISPOSE]?.();
    } catch {
      // The engine forgets a handle before its drop runs, so a drop that traps leaves nothing
      // behind. The trap is the engine failing, and the next call finds that out.
    }
  }
};

const MAPPING = { mappings: [], selectingLeft: undefined, selectingRight: undefined };

/** A target's engine handle, kept out of the public `Target` type. */
interface ParsedTarget extends Target {
  readonly object: ObjdiffWasm.diff.Object;
  readonly owner: object;
  disposed: boolean;
}

/** A scorer over `engine`, which must be objdiff-wasm `OBJDIFF_VERSION`. */
export function createScorer(engine: Engine, options: ScorerOptions = {}): Scorer {
  // OBJDIFF_VERSION goes into cache keys, so an engine of another version would make them lie.
  const version = engine.version();
  if (version !== OBJDIFF_VERSION) {
    throw new Error(`this scorer is for objdiff-wasm ${OBJDIFF_VERSION}, and the engine given is ${version}`);
  }
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

  // The one row walk `score` and `inspect` share, so the two can never count differently.
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
        // A row past a side's rowCount pads for the other side's insertions: `null` is a fact, not
        // a swallowed error.
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
        // how the scorer learns the engine can decode it. Displaying the candidate only where the
        // target's row says `none` would turn an engine refusal of the candidate into a score.
        const l = display(l0, lSym, lDisp.rowCount);
        const r = display(r0, rSym, rDisp.rowCount);
        const lk = KINDS[l?.diffKind ?? 'none'];
        const kind = lk !== 'none' ? lk : KINDS[r?.diffKind ?? 'none'];
        // objdiff diffs two undecoded rows as `none` whatever their bytes (every row of a Thumb
        // object under `arm.archVersion: v4`), so counting them would match objects nobody compared.
        // An undecoded row that differs anyway, such as data a size-0 target symbol absorbs past
        // its end, is counted.
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
            heldHandles.get(engine)?.delete(held);
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
      if (!disposed) {
        disposed = true;
        heldHandles.get(engine)?.delete(heldConfig);
        disposeAll(config);
      }
    },
  };
}

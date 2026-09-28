import type * as ObjdiffWasm from 'objdiff-wasm';

/** The objdiff engine: the `objdiff-wasm` module, initialized. */
export type Engine = typeof ObjdiffWasm;

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

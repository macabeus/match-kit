// @matchkit/scoring — score a compiled candidate against a target object with the objdiff engine.
// Runs on Node, Bun and browsers; the `#engine` import map picks each runtime's `loadEngine`.
export { loadEngine } from '#engine';
export type { Engine } from './engine.js';
export { EngineFailedError, SymbolNotFoundError, UndiffableError } from './errors.js';
export { rowText } from './row-text.js';
export { createScorer } from './scorer.js';
export type {
  DiffBreakdown,
  InspectedRow,
  Inspection,
  MatchScore,
  RowKind,
  Scorer,
  ScorerOptions,
  Target,
} from './types.js';
export { OBJDIFF_VERSION } from './version.js';

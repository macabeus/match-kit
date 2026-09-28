// @matchkit/scoring — score a compiled candidate against a target object with the objdiff engine.
// Runs on Node, Bun and browsers; the `#engine` import map picks each runtime's engine loader.
export { OBJDIFF_VERSION } from './engine/version.js';
export { EngineFailedError, SymbolNotFoundError, UndiffableError } from './scorer/errors.js';
export { createScorer } from './scorer/create-scorer.js';
export { rowText } from './scorer/row-text.js';
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

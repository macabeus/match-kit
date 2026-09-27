// @matchkit/scoring — score a compiled candidate against a target object with the objdiff engine.
//
// This entry runs anywhere: no `node:` import and no `Bun.*` API. `loadEngine` is the one piece
// that differs per runtime, and the package's `#engine` import map picks it.
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

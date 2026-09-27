// @matchkit/scoring/node — score object FILES, synchronously, with objdiff's default config.
//
// The engine loads in this module's top-level await, so `scoreFiles` is synchronous from the first
// call. Two memos make a ranked run cheap, and each is keyed on CONTENT, never on a path.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { type MatchScore, type Target, createScorer, loadEngine } from './index.js';

const scorer = createScorer(await loadEngine());

/**
 * The parsed TARGET, memoized on its own bytes. Every candidate in a ranked run is scored against
 * the same target, and parsing it once rather than once per candidate is what this saves (on
 * klonoa's 102 KB `gfx.o` the parse measured 3.81 ms, against 0.07 ms for a one-function
 * candidate).
 *
 * The key is the whole file content, compared byte for byte: a hit then PROVES the parse would be
 * the same, so a target rewritten in place between two calls is never scored against stale bytes.
 * One entry, held for the life of the process; `releaseTarget()` gives it back.
 */
let parsedTarget: { bytes: Uint8Array; target: Target; scores: Map<string, MatchScore> } | undefined;

/** Drop the memoized target: its engine handle, its bytes and every score taken against them. */
export function releaseTarget(): void {
  parsedTarget?.target.dispose();
  parsedTarget = undefined;
}

function targetEntry(path: string): NonNullable<typeof parsedTarget> {
  const bytes = new Uint8Array(readFileSync(path));
  if (parsedTarget && Buffer.compare(bytes, parsedTarget.bytes) === 0) {
    return parsedTarget;
  }
  // Parse BEFORE dropping the entry it replaces: a target that fails to parse must leave the
  // previous one intact and throw, never leave a disposed handle behind for the next call.
  const target = scorer.parseTarget(bytes);
  releaseTarget();
  parsedTarget = { bytes, target, scores: new Map() };
  return parsedTarget;
}

/**
 * Identical candidate objects have one score by definition, and a ranked run compiles far more
 * candidates than it produces distinct objects. The key is the candidate's content, hashed, plus
 * the symbol; the rest of what a score depends on is the target, so the memo belongs to the target
 * entry and dies with it. Never a path: a compile worker rewrites one scratch slot's object, so a
 * path key would answer for the previous candidate. A throw is never remembered.
 */
const candidateKey = (bytes: Uint8Array, symbol: string): string =>
  `${createHash('sha256').update(bytes).digest('hex')} ${symbol}`;

/** Score the candidate object at `candidatePath` against the target object at `targetPath`. */
export function scoreFiles(targetPath: string, candidatePath: string, symbol: string): MatchScore {
  const entry = targetEntry(targetPath);
  const bytes = new Uint8Array(readFileSync(candidatePath));
  const key = candidateKey(bytes, symbol);
  const remembered = entry.scores.get(key);
  if (remembered) {
    return remembered;
  }
  const scored = scorer.score(entry.target, bytes, symbol);
  entry.scores.set(key, scored);
  return scored;
}

// @matchkit/scoring/node — score object files synchronously, with objdiff's default config.
//
// The engine loads in this module's top-level await, so `scoreFiles` is synchronous from the first
// call. Two memos make a ranked run cheap; both are keyed on content, never on a path.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { type MatchScore, type Target, createScorer, loadEngine } from './index.js';

const scorer = createScorer(await loadEngine());

/**
 * The parsed target, memoized on its bytes. Every candidate in a ranked run is scored against the
 * same target, so it is parsed once (klonoa's 102 KB `gfx.o` parses in 3.81 ms, a one-function
 * candidate in 0.07 ms). The key is the whole file, compared byte for byte, so a target rewritten
 * in place is never scored against stale bytes. One entry, held until `releaseTarget()`.
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
  // Parse before releasing the previous entry, so a target that fails to parse throws and leaves
  // that entry intact.
  const target = scorer.parseTarget(bytes);
  releaseTarget();
  parsedTarget = { bytes, target, scores: new Map() };
  return parsedTarget;
}

/**
 * The score memo's key: the candidate's content hash and the symbol. A ranked run compiles far more
 * candidates than distinct objects, and identical objects score the same. The rest of what a score
 * depends on is the target, so the memo lives on the target entry and dies with it. Never a path: a
 * compile worker rewrites one scratch slot's object, so a path key would answer for the previous
 * candidate. A throw is never remembered.
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

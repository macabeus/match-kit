// @match-kit/scoring/files — score object files synchronously, with objdiff's default config. The
// engine loads in this module's top-level await.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { createScorer } from './scorer/create-scorer.js';
import type { MatchScore, Target } from './types.js';

const scorer = await createScorer();

/**
 * The parsed target, memoized on its whole content, so a file rewritten in place is parsed again.
 * One entry, held until `releaseTarget()`.
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
 * The score memo's key: the candidate's content hash and the symbol. The memo lives on the target
 * entry, which fixes the rest of what a score depends on. Content, not path: a compile worker writes
 * every candidate to the same path.
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

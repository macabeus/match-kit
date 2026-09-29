import type { MatchScore } from '../src/index.js';
import manifestJson from './fixtures/reference/manifest.json' with { type: 'json' };

/** One reference pair: a target and a candidate object, and the score asmlift published for them. */
export interface ReferencePair {
  id: string;
  toolchain: string;
  symbol: string;
  /** Paths relative to `test/fixtures/reference/`. */
  target: string;
  candidate: string;
  from: { row: string; decompiler: string; publishedScore: number; maxScore: number | null };
  expected: MatchScore;
}

export const REFERENCE_PAIRS: readonly ReferencePair[] = manifestJson.pairs as ReferencePair[];

/** A fixture's path from the repo root, which is where every test runs. */
export const fixturePath = (relative: string): string => `packages/scoring/test/fixtures/${relative}`;

import type { MatchScore } from '../src/index.js';
import manifestJson from './fixtures/golden/manifest.json' with { type: 'json' };

/** One golden pair: a target and a candidate object, and the score asmlift published for them. */
export interface GoldenPair {
  id: string;
  toolchain: string;
  symbol: string;
  /** Paths relative to `test/fixtures/golden/`. */
  target: string;
  candidate: string;
  from: { row: string; decompiler: string; publishedScore: number; maxScore: number | null };
  expected: MatchScore;
}

export const GOLDEN: readonly GoldenPair[] = manifestJson.pairs as GoldenPair[];

/** A fixture's path from the repo root, which is where every test runs. */
export const fixturePath = (relative: string): string => `packages/scoring/test/fixtures/${relative}`;

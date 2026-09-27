// The reference pairs, scored in a real browser: the engine loads without the Node fetch patch and
// gives the same numbers.
import { afterAll, expect, test } from 'vitest';
import { commands } from 'vitest/browser';

import { createScorer, loadEngine } from '../src/index.js';
import { REFERENCE_PAIRS, fixturePath } from './fixtures.js';

// Read on the vitest server (paths from the repo root) and carried across as base64.
const fetchBytes = async (relative: string): Promise<Uint8Array> =>
  Uint8Array.from(atob(await commands.readFile(fixturePath(`reference/${relative}`), 'base64')), (c) =>
    c.charCodeAt(0),
  );

const scorer = createScorer(await loadEngine());
afterAll(() => scorer.dispose());

test.each(REFERENCE_PAIRS.map((p) => [p.id, p] as const))('%s', async (_id, pair) => {
  const target = scorer.parseTarget(await fetchBytes(pair.target));
  try {
    expect(scorer.score(target, await fetchBytes(pair.candidate), pair.symbol)).toEqual(pair.expected);
  } finally {
    target.dispose();
  }
});

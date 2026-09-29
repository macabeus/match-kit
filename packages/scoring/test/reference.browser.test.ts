// The reference pairs, scored in a real browser through the browser engine loader.
import { afterAll, describe, expect, it } from 'vitest';
import { commands } from 'vitest/browser';

import { createScorer } from '../src/index.js';
import { REFERENCE_PAIRS, fixturePath } from './fixtures.js';

// Read on the vitest server (paths from the repo root) and carried across as base64.
const fetchBytes = async (relative: string): Promise<Uint8Array> =>
  Uint8Array.from(atob(await commands.readFile(fixturePath(`reference/${relative}`), 'base64')), (c) =>
    c.charCodeAt(0),
  );

const scorer = await createScorer();
afterAll(() => scorer.dispose());

describe('Scorer, in a browser', () => {
  it.each(REFERENCE_PAIRS.map((p) => [p.id, p] as const))('scores %s as asmlift published', async (_id, pair) => {
    using target = scorer.parseTarget(await fetchBytes(pair.target));
    expect(scorer.score(target, await fetchBytes(pair.candidate), pair.symbol)).toEqual(pair.expected);
  });
});

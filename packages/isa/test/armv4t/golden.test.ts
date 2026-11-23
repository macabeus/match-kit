// The pinned output (golden.ts), on Node and Bun.
import { expect, test } from 'vitest';

import { GOLDEN, goldenDigests } from './golden.js';

test('every Thumb halfword, a sample of bl pairs and a sample of ARM words print as pinned', async () => {
  expect(await goldenDigests()).toEqual(GOLDEN);
}, 30_000);

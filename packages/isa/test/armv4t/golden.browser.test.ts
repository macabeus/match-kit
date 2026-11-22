// The pinned output (golden.ts), in a real browser: the tables build and print there as they do on Node.
import { expect, test } from 'vitest';

import { GOLDEN, goldenDigests } from './golden.js';

test('every Thumb halfword, a sample of bl pairs and a sample of ARM words print as pinned, in a browser', async () => {
  expect(await goldenDigests()).toEqual(GOLDEN);
});

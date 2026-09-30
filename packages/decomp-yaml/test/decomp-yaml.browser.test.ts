// The browser entry, in Chromium.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { parseDecompYaml, toolBlock } from '../src/index.js';

describe('@match-kit/decomp-yaml', () => {
  it('parses a decomp.yaml and reads a tool block in a browser', () => {
    const config = parseDecompYaml('platform: gba\ntools:\n  asmlift:\n    target: agbcc\n');
    const block = toolBlock({ path: 'decomp.yaml', dir: '', config }, 'asmlift', z.object({ target: z.string() }));
    expect(block).toEqual({ target: 'agbcc' });
  });
});

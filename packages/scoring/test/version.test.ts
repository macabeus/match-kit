import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { expect, test } from 'vitest';

import { OBJDIFF_VERSION } from '../src/index.js';

const manifest = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8'));
const installed = JSON.parse(
  readFileSync(
    createRequire(join(import.meta.dirname, '..', 'package.json')).resolve('objdiff-wasm/package.json'),
    'utf8',
  ),
);

test('OBJDIFF_VERSION is the exact version package.json pins', () => {
  // An exact pin, never a range: two objdiff releases can score the same pair differently.
  expect(manifest.dependencies['objdiff-wasm']).toMatch(/^\d+\.\d+\.\d+$/);
  expect(OBJDIFF_VERSION).toBe(manifest.dependencies['objdiff-wasm']);
});

test('OBJDIFF_VERSION is the version installed', () => {
  expect(OBJDIFF_VERSION).toBe(installed.version);
});

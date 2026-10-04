// @match-kit/decomp-yaml/files — find and read a project's decomp.yaml on Node and Bun.
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { DecompYamlError } from './config/errors.js';
import { parseDecompYaml } from './config/parse.js';
import type { LoadedConfig } from './types.js';

const NAMES = ['decomp.yaml', 'decomp.yml'];

const isFile = (path: string): boolean => statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;

/**
 * The nearest decomp.yaml: `startDir` (default: the working directory) and then each parent in
 * turn, trying `decomp.yaml` before `decomp.yml` in each. `null` when there is none up to the root.
 */
export function findDecompYaml(startDir = process.cwd()): string | null {
  let dir = resolve(startDir);
  for (;;) {
    for (const name of NAMES) {
      const path = join(dir, name);
      if (isFile(path)) {
        return path;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

/** Read the decomp.yaml at `path`. A missing file throws. */
export function loadDecompYaml(path: string): LoadedConfig;
/** `null` (no decomp.yaml, as `findDecompYaml` reports it) reads as `null`. */
export function loadDecompYaml(path: string | null): LoadedConfig | null;
export function loadDecompYaml(path: string | null): LoadedConfig | null {
  if (path === null) {
    return null;
  }
  const absolute = resolve(path);
  let text: string;
  try {
    text = readFileSync(absolute, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new DecompYamlError(
      absolute,
      code === 'ENOENT' ? 'not found' : `cannot be read: ${error instanceof Error ? error.message : error}`,
      { cause: error },
    );
  }
  return { path: absolute, dir: dirname(absolute), config: parseDecompYaml(text, absolute) };
}

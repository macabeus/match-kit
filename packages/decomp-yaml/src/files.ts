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

/**
 * Read the decomp.yaml at `explicitPath`, or else the nearest one to `startDir`. `null` when no
 * explicit path is given and there is none; a missing explicit path throws.
 */
export function loadDecompYaml(explicitPath?: string, startDir?: string): LoadedConfig | null {
  const path = explicitPath === undefined ? findDecompYaml(startDir) : resolve(explicitPath);
  if (path === null) {
    return null;
  }
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new DecompYamlError(
      path,
      code === 'ENOENT' ? 'not found' : `cannot be read: ${error instanceof Error ? error.message : error}`,
      { cause: error },
    );
  }
  return { path, dir: dirname(path), config: parseDecompYaml(text, path) };
}

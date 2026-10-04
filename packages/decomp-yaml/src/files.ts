// @match-kit/decomp-yaml/files — find and read a project's decomp.yaml on Node and Bun.
import { readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { DecompYamlError } from './config/errors.js';
import { parseDecompYaml } from './config/parse.js';
import type { LoadedConfig } from './types.js';

const NAMES = ['decomp.yaml', 'decomp.yml'];

const isFile = (path: string): boolean => statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;

/** The path of the nearest decomp.yaml: `from` and then each parent, `decomp.yaml` before `decomp.yml`. */
function findDecompYaml(from: string): string | null {
  let dir = resolve(from);
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
export function loadDecompYaml(path: string): LoadedConfig {
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

/**
 * Read the nearest decomp.yaml: in `from` (default: the working directory) or its closest parent
 * that has one. `null` when no directory up to the root does.
 */
export function searchDecompYaml(from = process.cwd()): LoadedConfig | null {
  const path = findDecompYaml(from);
  return path === null ? null : loadDecompYaml(path);
}

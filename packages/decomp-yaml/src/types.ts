import type * as z from 'zod';

import type { DECOMP_YAML } from './config/spec.js';

/** A decomp.yaml that meets the decomp_settings spec. */
export type DecompConfig = z.output<typeof DECOMP_YAML>;

/** One version of the project, such as `us10`. */
export type DecompVersion = DecompConfig['versions'][number];

/** A version's paths, relative to the decomp.yaml's directory. */
export type VersionPaths = DecompVersion['paths'];

/** A decomp.yaml read from disk. */
export interface LoadedConfig {
  /** The file's absolute path. */
  path: string;
  /** The file's directory, which the config's relative paths are relative to. */
  dir: string;
  config: DecompConfig;
}

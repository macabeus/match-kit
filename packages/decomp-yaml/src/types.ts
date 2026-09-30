/**
 * A version's paths, relative to the decomp.yaml's directory. The decomp_settings spec requires
 * `target`, `build_dir`, `map` and `compiled_target`; here every path is optional.
 */
export interface VersionPaths {
  target?: string;
  build_dir?: string;
  map?: string;
  compiled_target?: string;
  elf?: string;
  expected_dir?: string;
  asm?: string;
  nonmatchings?: string;
  compressed_target?: string;
  compressed_compiled_target?: string;
}

/** One version of the project, such as `us10`. */
export interface DecompVersion {
  name?: string;
  fullname?: string;
  sha1?: string;
  paths?: VersionPaths;
}

/**
 * A decomp.yaml, typed after the decomp_settings spec. Every field is optional, and keys the spec
 * does not name are kept in the object.
 */
export interface DecompConfig {
  name?: string;
  repo?: string;
  website?: string;
  discord?: string;
  platform?: string;
  build_system?: string;
  versions?: DecompVersion[];
  /** Each tool's own block, keyed by the tool's name. Read one with `toolBlock`. */
  tools?: Record<string, unknown>;
}

/** A decomp.yaml read from disk. */
export interface LoadedConfig {
  /** The file's absolute path. */
  path: string;
  /** The file's directory, which the config's relative paths are relative to. */
  dir: string;
  config: DecompConfig;
}

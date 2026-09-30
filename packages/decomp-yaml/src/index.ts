// @match-kit/decomp-yaml — read a decomp.yaml (the decomp_settings format) and each tool's block.
// Runs on Node, Bun and browsers; finding and reading the file on disk is in `./files`.
export { DecompYamlError } from './config/errors.js';
export { parseDecompYaml } from './config/parse.js';
export { toolBlock } from './config/tool-block.js';
export type { DecompConfig, DecompVersion, LoadedConfig, VersionPaths } from './types.js';

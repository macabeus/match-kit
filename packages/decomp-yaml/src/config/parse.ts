import YAML from 'yaml';

import type { DecompConfig } from '../types.js';
import { DecompYamlError } from './errors.js';

const CONFIG_STRINGS = ['name', 'repo', 'website', 'discord', 'platform', 'build_system'];
const VERSION_STRINGS = ['name', 'fullname', 'sha1'];
const PATH_STRINGS = [
  'target',
  'build_dir',
  'map',
  'compiled_target',
  'elf',
  'expected_dir',
  'asm',
  'nonmatchings',
  'compressed_target',
  'compressed_compiled_target',
];

type Mapping = Record<string, unknown>;

const isMapping = (value: unknown): value is Mapping =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const describe = (value: unknown): string =>
  value === null ? 'null' : Array.isArray(value) ? 'a list' : isMapping(value) ? 'a mapping' : `a ${typeof value}`;

/**
 * Parse a decomp.yaml's text. A missing field is accepted, and so is a field left empty (`null`),
 * which is dropped; a field the spec names must otherwise have the spec's type. `path` names the
 * file in errors.
 */
export function parseDecompYaml(text: string, path = 'decomp.yaml'): DecompConfig {
  let parsed: unknown;
  try {
    parsed = YAML.parse(text);
  } catch (error) {
    throw new DecompYamlError(path, `is not valid YAML: ${error instanceof Error ? error.message : error}`, {
      cause: error,
    });
  }
  if (!isMapping(parsed)) {
    throw new DecompYamlError(path, `must be a mapping at the top level, not ${describe(parsed)}`);
  }
  const problems = fieldProblems(parsed);
  if (problems.length > 0) {
    throw new DecompYamlError(path, problems);
  }
  return parsed as DecompConfig;
}

function fieldProblems(config: Mapping): string[] {
  const problems: string[] = [];
  /** Whether `mapping[key]` is present and has the right kind; a `null` is dropped as absent. */
  const check = (mapping: Mapping, key: string, where: string, ok: (value: unknown) => boolean, kind: string) => {
    const value = mapping[key];
    if (value === null) {
      delete mapping[key];
      return false;
    }
    if (value === undefined) {
      return false;
    }
    if (!ok(value)) {
      problems.push(`${where} must be ${kind}, not ${describe(value)}`);
      return false;
    }
    return true;
  };
  const strings = (mapping: Mapping, keys: string[], prefix: string) => {
    for (const key of keys) {
      check(mapping, key, `${prefix}${key}`, (value) => typeof value === 'string', 'a string');
    }
  };

  strings(config, CONFIG_STRINGS, '');
  check(config, 'tools', 'tools', isMapping, 'a mapping');
  if (check(config, 'versions', 'versions', Array.isArray, 'a list')) {
    (config.versions as unknown[]).forEach((version, i) => {
      const where = `versions[${i}]`;
      if (!isMapping(version)) {
        problems.push(`${where} must be a mapping, not ${describe(version)}`);
        return;
      }
      strings(version, VERSION_STRINGS, `${where}.`);
      if (check(version, 'paths', `${where}.paths`, isMapping, 'a mapping')) {
        strings(version.paths as Mapping, PATH_STRINGS, `${where}.paths.`);
      }
    });
  }
  return problems;
}

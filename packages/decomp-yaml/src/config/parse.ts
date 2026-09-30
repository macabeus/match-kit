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
 * Parse a decomp.yaml's text. A missing field is accepted; a field the spec names must have the
 * spec's type. `path` names the file in errors.
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
  const expect = (value: unknown, where: string, ok: boolean, kind: string) => {
    if (value !== undefined && !ok) {
      problems.push(`${where} must be ${kind}, not ${describe(value)}`);
    }
  };
  const strings = (mapping: Mapping, keys: string[], prefix: string) => {
    for (const key of keys) {
      expect(mapping[key], `${prefix}${key}`, typeof mapping[key] === 'string', 'a string');
    }
  };

  strings(config, CONFIG_STRINGS, '');
  expect(config.tools, 'tools', isMapping(config.tools), 'a mapping');
  expect(config.versions, 'versions', Array.isArray(config.versions), 'a list');
  if (Array.isArray(config.versions)) {
    config.versions.forEach((version: unknown, i) => {
      const where = `versions[${i}]`;
      expect(version, where, isMapping(version), 'a mapping');
      if (isMapping(version)) {
        strings(version, VERSION_STRINGS, `${where}.`);
        expect(version.paths, `${where}.paths`, isMapping(version.paths), 'a mapping');
        if (isMapping(version.paths)) {
          strings(version.paths, PATH_STRINGS, `${where}.paths.`);
        }
      }
    });
  }
  return problems;
}

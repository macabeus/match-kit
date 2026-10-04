import SCHEMA from '#schema' with { type: 'json' };
import YAML from 'yaml';

import type { DecompConfig } from '../types.js';
import { DecompYamlError } from './errors.js';

/** The part of schema.json the parser reads: each field's type, and the fields inside it. */
interface SchemaNode {
  type?: string | string[];
  properties?: Record<string, SchemaNode>;
  items?: SchemaNode;
  $ref?: string;
}

const DEFS = (SCHEMA as { $defs: Record<string, SchemaNode> }).$defs;

type Mapping = Record<string, unknown>;

const isMapping = (value: unknown): value is Mapping =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const KINDS: Record<string, { is: (value: unknown) => boolean; name: string }> = {
  string: { is: (value) => typeof value === 'string', name: 'a string' },
  object: { is: isMapping, name: 'a mapping' },
  array: { is: Array.isArray, name: 'a list' },
};

const describe = (value: unknown): string =>
  value === null ? 'null' : Array.isArray(value) ? 'a list' : isMapping(value) ? 'a mapping' : `a ${typeof value}`;

/**
 * Parse a decomp.yaml's text. Each field schema.json names must have the type it gives; unlike the
 * schema, no field is required, keys it does not name are kept, and a field left empty (`null`) is
 * dropped as if it were missing. `path` names the file in errors.
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
  const problems: string[] = [];
  checkFields(parsed, SCHEMA as SchemaNode, '', problems);
  if (problems.length > 0) {
    throw new DecompYamlError(path, problems);
  }
  return parsed as DecompConfig;
}

/** Check `value` against `node`, adding a problem for each field of the wrong type to `problems`. */
function check(value: unknown, node: SchemaNode, where: string, problems: string[]): void {
  const resolved = node.$ref === undefined ? node : DEFS[node.$ref.slice('#/$defs/'.length)];
  const kinds = [resolved.type ?? []].flat().filter((kind) => kind !== 'null');
  if (!kinds.some((kind) => KINDS[kind].is(value))) {
    problems.push(`${where} must be ${kinds.map((kind) => KINDS[kind].name).join(' or ')}, not ${describe(value)}`);
  } else if (isMapping(value)) {
    checkFields(value, resolved, `${where}.`, problems);
  } else if (Array.isArray(value) && resolved.items) {
    value.forEach((item, i) => check(item, resolved.items!, `${where}[${i}]`, problems));
  }
}

/** Check each field `node` names in `mapping`, dropping the ones left empty. */
function checkFields(mapping: Mapping, node: SchemaNode, prefix: string, problems: string[]): void {
  for (const [key, field] of Object.entries(node.properties ?? {})) {
    if (mapping[key] === null) {
      delete mapping[key];
    } else if (mapping[key] !== undefined) {
      check(mapping[key], field, `${prefix}${key}`, problems);
    }
  }
}

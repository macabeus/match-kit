// `schema.json`: the decomp_settings spec as a JSON Schema, checked against the files the official
// reader accepts and refuses, against this package's types and parser, and against SPEC.md.
import { Ajv2020 } from 'ajv/dist/2020.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as prettier from 'prettier';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';

import {
  type DecompConfig,
  type DecompVersion,
  DecompYamlError,
  type VersionPaths,
  parseDecompYaml,
} from '../src/index.js';

const PACKAGE = join(import.meta.dirname, '..');
const SCHEMA = JSON.parse(readFileSync(join(PACKAGE, 'schema.json'), 'utf8'));
const validate = new Ajv2020({ allErrors: true }).compile(SCHEMA);
const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');

const SPEC_COMPLETE = YAML.parse(fixture('spec-complete.yaml'));
const MINIMAL = {
  name: 'Example',
  platform: 'n64',
  versions: [{ name: 'us', fullname: 'US', paths: { target: 't', build_dir: 'b', map: 'm', compiled_target: 'c' } }],
};

/** `MINIMAL` with `edit` applied to a deep copy. */
function minimal(edit: (config: Record<string, any>) => void): unknown {
  const config = structuredClone(MINIMAL) as Record<string, any>;
  edit(config);
  return config;
}

interface Property {
  type: string | string[];
  description: string;
  examples?: string[];
  $ref?: string;
  items?: { $ref: string };
}
interface ObjectSchema {
  required?: string[];
  properties: Record<string, Property>;
}

/** Each object the schema defines, with the path a field of it has in a decomp.yaml. */
const OBJECTS: [prefix: string, schema: ObjectSchema][] = [
  ['', SCHEMA],
  ['versions[0].', SCHEMA.$defs.version],
  ['versions[0].paths.', SCHEMA.$defs.paths],
];

describe('schema.json', () => {
  it("names this package's version in its $id and in every documented URL", () => {
    const { version } = JSON.parse(readFileSync(join(PACKAGE, 'package.json'), 'utf8'));
    const expected = `https://cdn.jsdelivr.net/npm/@match-kit/decomp-yaml@${version}/schema.json`;
    expect(SCHEMA.$id).toBe(expected);
    for (const file of ['SPEC.md', 'README.md']) {
      const urls = readFileSync(join(PACKAGE, file), 'utf8').match(
        /https:\/\/cdn\.jsdelivr\.net\/npm\/@match-kit\/decomp-yaml(@[^/]+)?\/schema\.json/g,
      );
      expect(urls, file).not.toBeNull();
      expect(new Set(urls), `${file}: run scripts/sync-schema-version.mjs`).toEqual(new Set([expected]));
    }
  });

  it('accepts a file with every field the spec names', () => {
    expect(validate(SPEC_COMPLETE), JSON.stringify(validate.errors)).toBe(true);
  });

  it('accepts a file with only the fields the spec requires', () => {
    expect(validate(MINIMAL), JSON.stringify(validate.errors)).toBe(true);
  });

  it('accepts an optional field left empty', () => {
    expect(validate(minimal((c) => ((c.repo = null), (c.tools = null), (c.versions[0].paths.elf = null))))).toBe(true);
  });

  it('accepts any block under tools', () => {
    expect(validate(minimal((c) => (c.tools = { mytool: { anything: [1, 2] }, other: 3 })))).toBe(true);
  });

  it.each([
    ['name', (c: Record<string, any>) => delete c.name],
    ['platform', (c: Record<string, any>) => delete c.platform],
    ['versions', (c: Record<string, any>) => delete c.versions],
    ['versions[0].fullname', (c: Record<string, any>) => delete c.versions[0].fullname],
    ['versions[0].paths', (c: Record<string, any>) => delete c.versions[0].paths],
    ['versions[0].paths.target', (c: Record<string, any>) => delete c.versions[0].paths.target],
    ['versions[0].paths.build_dir', (c: Record<string, any>) => delete c.versions[0].paths.build_dir],
    ['versions[0].paths.map', (c: Record<string, any>) => delete c.versions[0].paths.map],
    ['versions[0].paths.compiled_target', (c: Record<string, any>) => delete c.versions[0].paths.compiled_target],
  ])('refuses a file without %s', (_, edit) => {
    expect(validate(minimal(edit))).toBe(false);
  });

  it.each([
    ['at the top level', (c: Record<string, any>) => (c.notes = 'x')],
    ['in a version', (c: Record<string, any>) => (c.versions[0].region = 'x')],
    ["in a version's paths", (c: Record<string, any>) => (c.versions[0].paths.baserom = 'x')],
  ])('refuses a key the spec does not name %s', (_, edit) => {
    expect(validate(minimal(edit))).toBe(false);
  });

  it('refuses a file written for decomp_settings 0.0.8', () => {
    expect(validate(YAML.parse(fixture('decomp-settings-0.0.8.yaml')))).toBe(false);
  });

  it('names the same fields as DecompConfig, DecompVersion and VersionPaths', () => {
    const config: Record<keyof DecompConfig, true> = {
      name: true,
      repo: true,
      website: true,
      discord: true,
      platform: true,
      build_system: true,
      versions: true,
      tools: true,
    };
    const version: Record<keyof DecompVersion, true> = { name: true, fullname: true, sha1: true, paths: true };
    const paths: Record<keyof VersionPaths, true> = {
      target: true,
      build_dir: true,
      map: true,
      compiled_target: true,
      elf: true,
      expected_dir: true,
      asm: true,
      nonmatchings: true,
      compressed_target: true,
      compressed_compiled_target: true,
    };
    expect(OBJECTS.map(([, schema]) => Object.keys(schema.properties).sort())).toEqual(
      [config, version, paths].map((fields) => Object.keys(fields).sort()),
    );
  });

  it('has every string field it names enforced by parseDecompYaml', () => {
    for (const [prefix, schema] of OBJECTS) {
      for (const [key, property] of Object.entries(schema.properties)) {
        if (!([property.type].flat() as string[]).includes('string')) {
          continue;
        }
        const config = minimal((c) => {
          const parent = prefix === '' ? c : prefix === 'versions[0].' ? c.versions[0] : c.versions[0].paths;
          parent[key] = 64;
        });
        expect(() => parseDecompYaml(YAML.stringify(config)), `${prefix}${key}`).toThrow(
          new DecompYamlError('decomp.yaml', `${prefix}${key} must be a string, not a number`),
        );
      }
    }
  });
});

const TYPE_NAMES: Record<string, string> = { string: 'string', object: 'mapping', array: 'list' };

/** The field reference SPEC.md carries, built from the schema's descriptions. */
function fieldReference(): string {
  const tables = OBJECTS.map(([prefix, schema]) => {
    const rows = Object.entries(schema.properties).map(([key, p]) => {
      const type = p.$ref
        ? 'mapping'
        : p.items
          ? 'list of versions'
          : [p.type]
              .flat()
              .filter((t) => t !== 'null')
              .map((t) => TYPE_NAMES[t])
              .join(' or ');
      const required = schema.required?.includes(key) ? 'yes' : '';
      const example = p.examples ? `\`${p.examples[0]}\`` : '';
      return `| \`${prefix.replaceAll('[0]', '[]')}${key}\` | ${type} | ${required} | ${p.description} | ${example} |`;
    });
    return ['| Field | Type | Required | Description | Example |', '| --- | --- | --- | --- | --- |', ...rows].join(
      '\n',
    );
  });
  return tables.join('\n\n');
}

const SPEC_PATH = join(PACKAGE, 'SPEC.md');
const SPEC = readFileSync(SPEC_PATH, 'utf8');

describe('SPEC.md', () => {
  it('has an example the schema accepts', () => {
    const example = SPEC.match(/## Example\n\n```yaml\n([\s\S]*?)```/)?.[1];
    expect(example, 'SPEC.md has an example').toBeDefined();
    expect(validate(YAML.parse(example!)), JSON.stringify(validate.errors)).toBe(true);
  });

  it("carries the schema's field reference (vitest -u rewrites it)", async () => {
    const spec = SPEC;
    const START = '<!-- fields: generated from schema.json by test/schema.test.ts -->';
    const END = '<!-- fields: end -->';
    const at = spec.indexOf(START);
    const end = spec.indexOf(END);
    expect(at, 'SPEC.md has the field markers').toBeGreaterThan(-1);
    const spliced = `${spec.slice(0, at + START.length)}\n\n${fieldReference()}\n\n${spec.slice(end)}`;
    const options = await prettier.resolveConfig(SPEC_PATH);
    const updated = await prettier.format(spliced, { ...options, filepath: SPEC_PATH });
    await expect(updated).toMatchFileSnapshot(SPEC_PATH);
  });
});

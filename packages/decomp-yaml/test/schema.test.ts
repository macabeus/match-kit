// schema.json and SPEC.md's field reference are generated from the zod spec (src/config/spec.ts);
// `vitest -u` rewrites both. The schema must give the same verdict as parseDecompYaml.
import { Ajv2020 } from 'ajv/dist/2020.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as prettier from 'prettier';
import { describe, expect, it } from 'vitest';
import YAML from 'yaml';
import * as z from 'zod';

import { DECOMP_YAML } from '../src/config/spec.js';
import { parseDecompYaml } from '../src/index.js';

const PACKAGE = join(import.meta.dirname, '..');
const SCHEMA_PATH = join(PACKAGE, 'schema.json');
const SPEC_PATH = join(PACKAGE, 'SPEC.md');
const { version } = JSON.parse(readFileSync(join(PACKAGE, 'package.json'), 'utf8'));
const SCHEMA_URL = `https://cdn.jsdelivr.net/npm/@match-kit/decomp-yaml@${version}/schema.json`;

/** schema.json as generated from the zod spec. */
function generatedSchema(): Record<string, any> {
  const { $schema, title, description, ...rest } = z.toJSONSchema(DECOMP_YAML, {
    target: 'draft-2020-12',
    io: 'input',
  });
  return { $schema, $id: SCHEMA_URL, title, description, ...rest };
}

const format = async (text: string, filepath: string) =>
  prettier.format(text, { ...(await prettier.resolveConfig(filepath)), filepath });

const SCHEMA = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
const validate = new Ajv2020({ allErrors: true }).compile(SCHEMA);
const fixture = (name: string) => readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');

const PATHS = { target: 't', build_dir: 'b', map: 'm', compiled_target: 'c' };
const MINIMAL = { name: 'Example', platform: 'n64', versions: [{ name: 'us', fullname: 'US', paths: PATHS }] };

/** `MINIMAL` with `edit` applied to a deep copy. */
function minimal(edit: (config: Record<string, any>) => void): unknown {
  const config = structuredClone(MINIMAL) as Record<string, any>;
  edit(config);
  return config;
}

const accepts = (document: unknown) => {
  try {
    parseDecompYaml(YAML.stringify(document));
    return true;
  } catch {
    return false;
  }
};

describe('schema.json', () => {
  it('is generated from the zod spec', async () => {
    await expect(await format(JSON.stringify(generatedSchema()), SCHEMA_PATH)).toMatchFileSnapshot(SCHEMA_PATH);
  });

  it("names this package's version in its $id and in every documented URL", () => {
    expect(SCHEMA.$id).toBe(SCHEMA_URL);
    for (const file of ['SPEC.md', 'README.md']) {
      const urls = readFileSync(join(PACKAGE, file), 'utf8').match(
        /https:\/\/cdn\.jsdelivr\.net\/npm\/@match-kit\/decomp-yaml(@[^/]+)?\/schema\.json/g,
      );
      expect(urls, file).not.toBeNull();
      expect(new Set(urls), `${file}: run scripts/sync-schema-version.mjs`).toEqual(new Set([SCHEMA_URL]));
    }
  });

  it.each<[string, unknown, boolean]>([
    ['a file with every field the spec names', YAML.parse(fixture('spec-complete.yaml')), true],
    ['a file with only the required fields', MINIMAL, true],
    ['no versions', minimal((c) => (c.versions = [])), true],
    [
      'optional fields left empty',
      minimal((c) => ((c.repo = null), (c.tools = null), (c.versions[0].paths.elf = null))),
      true,
    ],
    ['any block under tools', minimal((c) => (c.tools = { mytool: { anything: [1, 2] }, other: 3 })), true],
    ['no name', minimal((c) => delete c.name), false],
    ['no platform', minimal((c) => delete c.platform), false],
    ['no versions key', minimal((c) => delete c.versions), false],
    ['a version without fullname', minimal((c) => delete c.versions[0].fullname), false],
    ['a version without paths', minimal((c) => delete c.versions[0].paths), false],
    ['paths without target', minimal((c) => delete c.versions[0].paths.target), false],
    ['paths without build_dir', minimal((c) => delete c.versions[0].paths.build_dir), false],
    ['paths without map', minimal((c) => delete c.versions[0].paths.map), false],
    ['paths without compiled_target', minimal((c) => delete c.versions[0].paths.compiled_target), false],
    ['an unknown top-level key', minimal((c) => (c.notes = 'x')), false],
    ['an unknown version key', minimal((c) => (c.versions[0].region = 'x')), false],
    ['an unknown path key', minimal((c) => (c.versions[0].paths.baserom = 'x')), false],
    ['a number for a string', minimal((c) => (c.platform = 64)), false],
    ['a list for tools', minimal((c) => (c.tools = ['asmlift'])), false],
  ])('agrees with parseDecompYaml on %s', (_, document, valid) => {
    expect(validate(document), JSON.stringify(validate.errors)).toBe(valid);
    expect(accepts(document)).toBe(valid);
  });
});

const TYPE_NAMES: Record<string, string> = { string: 'string', object: 'mapping', array: 'list of versions' };

/** The field reference SPEC.md carries, built from schema.json's descriptions. */
function fieldReference(): string {
  const objects: [string, Record<string, any>][] = [
    ['', SCHEMA],
    ['versions[].', SCHEMA.$defs.version],
    ['versions[].paths.', SCHEMA.$defs.paths],
  ];
  const tables = objects.map(([prefix, object]) => {
    const rows = Object.entries<Record<string, any>>(object.properties).map(([key, property]) => {
      const target = property.$ref ? SCHEMA.$defs[property.$ref.split('/').at(-1)] : property;
      const types = (property.anyOf ?? [target]).flatMap((branch: Record<string, any>) => [branch.type].flat());
      const type = types
        .filter((t: string) => t !== 'null')
        .map((t: string) => TYPE_NAMES[t])
        .join(' or ');
      const required = object.required?.includes(key) ? 'yes' : '';
      const example = target.examples ? `\`${target.examples[0]}\`` : '';
      return `| \`${prefix}${key}\` | ${type} | ${required} | ${target.description} | ${example} |`;
    });
    return ['| Field | Type | Required | Description | Example |', '| --- | --- | --- | --- | --- |', ...rows].join(
      '\n',
    );
  });
  return tables.join('\n\n');
}

const SPEC = readFileSync(SPEC_PATH, 'utf8');

describe('SPEC.md', () => {
  it('has an example the schema accepts', () => {
    const example = SPEC.match(/## Example\n\n```yaml\n([\s\S]*?)```/)?.[1];
    expect(example, 'SPEC.md has an example').toBeDefined();
    expect(validate(YAML.parse(example!)), JSON.stringify(validate.errors)).toBe(true);
  });

  it("carries the schema's field reference (vitest -u rewrites it)", async () => {
    const START = '<!-- fields: generated from schema.json by test/schema.test.ts -->';
    const END = '<!-- fields: end -->';
    const at = SPEC.indexOf(START);
    expect(at, 'SPEC.md has the field markers').toBeGreaterThan(-1);
    const spliced = `${SPEC.slice(0, at + START.length)}\n\n${fieldReference()}\n\n${SPEC.slice(SPEC.indexOf(END))}`;
    await expect(await format(spliced, SPEC_PATH)).toMatchFileSnapshot(SPEC_PATH);
  });
});

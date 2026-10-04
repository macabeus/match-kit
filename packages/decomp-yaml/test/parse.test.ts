// `parseDecompYaml`: the text of a decomp.yaml to a config that meets the decomp_settings spec.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { DecompYamlError, parseDecompYaml } from '../src/index.js';

const SPEC_COMPLETE = readFileSync(join(import.meta.dirname, 'fixtures', 'spec-complete.yaml'), 'utf8');
const MINIMAL = 'name: Example\nplatform: gba\nversions: []\n';
const PATHS = '    paths:\n      target: t\n      build_dir: b\n      map: m\n      compiled_target: c\n';

/** The problems `parseDecompYaml` reports for `text`. */
function problemsOf(text: string): readonly string[] {
  try {
    parseDecompYaml(text, 'p/decomp.yaml');
  } catch (error) {
    expect(error).toBeInstanceOf(DecompYamlError);
    expect((error as DecompYamlError).path).toBe('p/decomp.yaml');
    return (error as DecompYamlError).problems;
  }
  throw new Error('parseDecompYaml did not throw');
}

describe('parseDecompYaml', () => {
  it('reads every field the decomp_settings spec names', () => {
    const config = parseDecompYaml(SPEC_COMPLETE);
    expect(config).toMatchObject({ name: 'Dr. Mario 64', platform: 'n64', build_system: 'make' });
    expect(config.versions[0]).toMatchObject({ name: 'us', fullname: 'US' });
    expect(config.versions[0]?.paths.compressed_compiled_target).toBe('build/us/drmario64.us.compressed.z64');
    expect(config.tools?.asmlift).toEqual({ target: 'ido7.1' });
  });

  it('reads a file with only the fields the spec requires', () => {
    expect(parseDecompYaml(MINIMAL)).toEqual({ name: 'Example', platform: 'gba', versions: [] });
  });

  it('reads a field left empty as missing', () => {
    const config = parseDecompYaml(
      `${MINIMAL.replace('versions: []\n', '')}repo:\ntools: ~\nversions:\n  - name: us\n    fullname: US\n    sha1:\n${PATHS}      elf:\n`,
    );
    expect(config.repo).toBeUndefined();
    expect(config.tools).toBeUndefined();
    expect(config.versions[0]?.sha1).toBeUndefined();
    expect(config.versions[0]?.paths.elf).toBeUndefined();
  });

  it('throws for each field the spec requires and the file lacks', () => {
    expect(problemsOf('platform: gba\ntools:\n  asmlift:\n    target: agbcc\n')).toEqual([
      'name: Invalid input: expected string, received undefined',
      'versions: Invalid input: expected array, received undefined',
    ]);
    expect(
      problemsOf(`${MINIMAL.replace('versions: []', 'versions:\n  - name: us\n    paths:\n      target: t')}`),
    ).toEqual([
      'versions[0].fullname: Invalid input: expected string, received undefined',
      'versions[0].paths.build_dir: Invalid input: expected string, received undefined',
      'versions[0].paths.map: Invalid input: expected string, received undefined',
      'versions[0].paths.compiled_target: Invalid input: expected string, received undefined',
    ]);
  });

  it('throws for a key the spec does not name, outside tools', () => {
    expect(
      problemsOf(`${MINIMAL}github: https://example.com\ntools:\n  mytool:\n    anything: [1]\n`).filter(
        (problem) => !problem.startsWith('tools'),
      ),
    ).toEqual(['Unrecognized key: "github"']);
    expect(
      problemsOf(
        MINIMAL.replace('versions: []', `versions:\n  - name: us\n    fullname: US\n${PATHS}      baserom: r`),
      ),
    ).toEqual(['versions[0].paths: Unrecognized key: "baserom"']);
  });

  it('throws for every field of the wrong type, each named by its path', () => {
    expect(
      problemsOf(
        [
          'name: Example',
          'platform: 64',
          'tools: [asmlift]',
          'versions:',
          '  - name: us',
          '    fullname: 1.0',
          PATHS.replace('target: t', 'target: [a, b]').trimEnd(),
          '  - just a string',
        ].join('\n'),
      ),
    ).toEqual([
      'platform: Invalid input: expected string, received number',
      'versions[0].fullname: Invalid input: expected string, received number',
      'versions[0].paths.target: Invalid input: expected string, received array',
      'versions[1]: Invalid input: expected object, received string',
      'tools: Invalid input: expected record, received array',
    ]);
  });

  it('throws for text that is not valid YAML, naming the file', () => {
    expect(problemsOf('platform: [unclosed\n')[0]).toMatch(/^is not valid YAML: /);
  });

  it.each([
    ['a list', '- one\n- two\n', 'array'],
    ['a string', 'just text\n', 'string'],
    ['empty', '', 'null'],
  ])('throws when the top level is %s', (_, text, received) => {
    expect(problemsOf(text)).toEqual([`Invalid input: expected object, received ${received}`]);
  });

  it('prefixes each problem with the file in its message', () => {
    expect(() => parseDecompYaml('versions: 3\n')).toThrow(
      /^decomp\.yaml: name: Invalid input: expected string, received undefined\n/,
    );
  });
});

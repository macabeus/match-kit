// `parseDecompYaml`: the text of a decomp.yaml to a typed config.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { DecompYamlError, parseDecompYaml } from '../src/index.js';

const SPEC_COMPLETE = readFileSync(join(import.meta.dirname, 'fixtures', 'spec-complete.yaml'), 'utf8');

/** The error `parseDecompYaml` throws for `text`. */
function errorFor(text: string): DecompYamlError {
  try {
    parseDecompYaml(text, 'p/decomp.yaml');
  } catch (error) {
    expect(error).toBeInstanceOf(DecompYamlError);
    return error as DecompYamlError;
  }
  throw new Error('parseDecompYaml did not throw');
}

describe('parseDecompYaml', () => {
  it('reads every field the decomp_settings spec names', () => {
    const config = parseDecompYaml(SPEC_COMPLETE);
    expect(config).toMatchObject({ name: 'Dr. Mario 64', platform: 'n64', build_system: 'make' });
    expect(config.versions?.[0]).toMatchObject({ name: 'us', fullname: 'US' });
    expect(config.versions?.[0]?.paths?.compressed_compiled_target).toBe('build/us/drmario64.us.compressed.z64');
    expect(config.tools?.asmlift).toEqual({ target: 'ido7.1' });
  });

  it('accepts a config that has none of the fields the spec requires', () => {
    expect(parseDecompYaml('platform: gba\ntools:\n  asmlift:\n    target: agbcc\n')).toEqual({
      platform: 'gba',
      tools: { asmlift: { target: 'agbcc' } },
    });
  });

  it('keeps keys the spec does not name', () => {
    expect(parseDecompYaml('platform: gc\nnotes: kept\nversions:\n  - name: us\n    region: ntsc\n')).toEqual({
      platform: 'gc',
      notes: 'kept',
      versions: [{ name: 'us', region: 'ntsc' }],
    });
  });

  it('throws for text that is not valid YAML, naming the file', () => {
    const error = errorFor('platform: [unclosed\n');
    expect(error.path).toBe('p/decomp.yaml');
    expect(error.message).toMatch(/^p\/decomp\.yaml: is not valid YAML: /);
  });

  it.each([
    ['a list', '- one\n- two\n'],
    ['a string', 'just text\n'],
    ['null', ''],
  ])('throws when the top level is %s', (kind, text) => {
    expect(errorFor(text).problems).toEqual([`must be a mapping at the top level, not ${kind}`]);
  });

  it('throws for every field of the wrong type, each named by its path', () => {
    const error = errorFor(
      [
        'platform: 64',
        'tools: [asmlift]',
        'versions:',
        '  - name: us',
        '    fullname: 1.0',
        '    paths:',
        '      elf: [a, b]',
        '  - just a string',
      ].join('\n'),
    );
    expect(error.problems).toEqual([
      'platform must be a string, not a number',
      'tools must be a mapping, not a list',
      'versions[0].fullname must be a string, not a number',
      'versions[0].paths.elf must be a string, not a list',
      'versions[1] must be a mapping, not a string',
    ]);
    expect(error.message.split('\n')).toEqual(error.problems.map((p) => `p/decomp.yaml: ${p}`));
  });

  it('names the file decomp.yaml when no path is given', () => {
    expect(() => parseDecompYaml('versions: 3\n')).toThrow('decomp.yaml: versions must be a list, not a number');
  });
});

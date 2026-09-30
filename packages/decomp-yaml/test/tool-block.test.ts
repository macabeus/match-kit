// `toolBlock`: a tool's block, read through the tool's own Standard Schema.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { DecompYamlError, type LoadedConfig, parseDecompYaml, toolBlock } from '../src/index.js';

const loaded = (text: string): LoadedConfig => ({ path: 'p/decomp.yaml', dir: 'p', config: parseDecompYaml(text) });

const TRANSMUTER = z.strictObject({
  compiler: z.string().optional(),
  concurrency: z.number().int().positive().optional(),
  ruleWeights: z.record(z.string(), z.number()).optional(),
  disabledRules: z.array(z.string()).optional(),
});

describe('toolBlock', () => {
  it("returns the schema's output for the tool's block", () => {
    const config = loaded('tools:\n  transmuter:\n    concurrency: 4\n    disabledRules: [swap]\n');
    expect(toolBlock(config, 'transmuter', TRANSMUTER)).toEqual({ concurrency: 4, disabledRules: ['swap'] });
  });

  it('returns what the schema transforms the block into', () => {
    const schema = z.object({ jobs: z.number().default(1) }).transform((b) => ({ ...b, parallel: b.jobs > 1 }));
    expect(toolBlock(loaded('tools:\n  t: {}\n'), 't', schema)).toEqual({ jobs: 1, parallel: false });
  });

  it.each([
    ['there is no config', null],
    ['the config has no tools', loaded('platform: gba\n')],
    ['the config has no block for the tool', loaded('tools:\n  asmlift: {}\n')],
    ['the block is empty', loaded('tools:\n  transmuter:\n')],
    ['the tool is named like an Object method', loaded('tools: {}\n')],
  ])('returns undefined when %s', (_, config) => {
    expect(toolBlock(config, config?.config.tools ? 'transmuter' : 'toString', TRANSMUTER)).toBeUndefined();
  });

  it('throws with every issue, each named by its key path', () => {
    const config = loaded('tools:\n  transmuter:\n    concurrency: "4"\n    ruleWeights:\n      swap: high\n');
    let error: unknown;
    try {
      toolBlock(config, 'transmuter', TRANSMUTER);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(DecompYamlError);
    expect((error as DecompYamlError).problems).toEqual([
      'tools.transmuter.concurrency: Invalid input: expected number, received string',
      'tools.transmuter.ruleWeights.swap: Invalid input: expected number, received string',
    ]);
    expect((error as DecompYamlError).path).toBe('p/decomp.yaml');
  });

  it('names a list index in a key path', () => {
    const config = loaded('tools:\n  transmuter:\n    disabledRules: [swap, 3]\n');
    expect(() => toolBlock(config, 'transmuter', TRANSMUTER)).toThrow(
      'p/decomp.yaml: tools.transmuter.disabledRules[1]: Invalid input: expected string, received number',
    );
  });

  it('lets the schema decide whether a key it does not name is an error', () => {
    const config = loaded('tools:\n  transmuter:\n    compilier: gcc\n');
    expect(() => toolBlock(config, 'transmuter', TRANSMUTER)).toThrow(
      /tools\.transmuter: Unrecognized key: "compilier"/,
    );
    expect(toolBlock(config, 'transmuter', z.object({ compiler: z.string().optional() }))).toEqual({});
  });

  it('throws a TypeError for a schema that validates asynchronously', () => {
    const schema = z.object({}).refine(async () => true);
    expect(() => toolBlock(loaded('tools:\n  t: {}\n'), 't', schema)).toThrow(TypeError);
  });
});

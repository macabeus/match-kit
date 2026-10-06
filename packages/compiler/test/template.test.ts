// The command template: which placeholders it takes, and what reaches the shell.
import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';

import { type Outcome, type Runner, type RunnerOptions, TemplateError, createRunner } from '../src/index.js';

const RUNNERS: Runner[] = [];
afterAll(() => Promise.all(RUNNERS.map((runner) => runner.dispose())));

/** A runner disposed when the suite ends. */
function runner(template: string, options: RunnerOptions = {}): Runner {
  const r = createRunner(template, options);
  RUNNERS.push(r);
  return r;
}

const text = (outcome: Outcome): string => {
  if (outcome.kind !== 'ok') {
    throw new Error(`the compile failed: ${JSON.stringify(outcome)}`);
  }
  return readFileSync(outcome.object, 'utf8');
};

describe('createRunner', () => {
  it('refuses a template without {{inputPath}} or {{outputPath}}', () => {
    expect(() => createRunner('cc -c {{inputPath}}')).toThrow(TemplateError);
    expect(() => createRunner('cc -c {{inputPath}}')).toThrow(
      'compile command lacks {{outputPath}}: cc -c {{inputPath}}',
    );
    expect(() => createRunner('true')).toThrow('compile command lacks {{inputPath}} and {{outputPath}}: true');
  });

  it('names an unknown placeholder', () => {
    expect(() => createRunner('cc {{functionName}} {{inputPath}} -o {{outputPath}}')).toThrow(
      'compile command has an unknown placeholder {{functionName}} (known: {{inputPath}}, {{outputPath}}, {{symbol}}, {{flags}})',
    );
  });

  it('refuses {{flags}} without flags, and flags without {{flags}}', () => {
    expect(() => createRunner('cc {{flags}} {{inputPath}} -o {{outputPath}}')).toThrow(
      'compile command takes {{flags}}, and no flags were given',
    );
    expect(() => createRunner('cc {{inputPath}} -o {{outputPath}}', { flags: ['-O2'] })).toThrow(
      'compile command has no {{flags}} to take the flags given',
    );
  });

  it('keeps the template, and the command with its flags filled', () => {
    const r = createRunner('cc {{flags}} {{inputPath}} -o {{outputPath}}', { flags: ['-O2', '-g'] });
    expect(r.template).toBe('cc {{flags}} {{inputPath}} -o {{outputPath}}');
    expect(r.command).toBe('cc -O2 -g {{inputPath}} -o {{outputPath}}');
  });
});

describe('the rendered command', () => {
  it('fills {{symbol}} with the symbol', async () => {
    using outcome = await runner('printf %s {{symbol}} > {{outputPath}} # {{inputPath}}').compile('', {
      ext: 'c',
      symbol: 'Foo_Bar',
    });
    expect(text(outcome)).toBe('Foo_Bar');
  });

  it('fills {{flags}} with each flag as one shell word, quoting only where the shell needs it', async () => {
    const flags = ['-pragma', 'cats off', "-DQ='x'", '-O4,p'];
    using outcome = await runner("printf '%s\\n' {{flags}} > {{outputPath}} # {{inputPath}}", { flags }).compile('', {
      ext: 'c',
    });
    expect(text(outcome)).toBe(`${flags.join('\n')}\n`);
  });

  it('leaves the quoting of the paths to the template', async () => {
    using outcome = await runner(
      'cp "{{inputPath}}" "{{outputPath}}.tmp" && mv {{outputPath}}.tmp {{outputPath}}',
    ).compile('int x;', { ext: 'c' });
    expect(text(outcome)).toBe('int x;');
  });

  it('refuses a symbol the shell would read as more than a word', async () => {
    await expect(
      runner('cp {{inputPath}} {{outputPath}} # {{symbol}}').compile('', { ext: 'c', symbol: 'f; rm -rf ~' }),
    ).rejects.toThrow('the symbol name contains shell-unsafe characters, refusing to substitute: "f; rm -rf ~"');
  });

  it('accepts any symbol when the template takes none', async () => {
    using outcome = await runner('cp {{inputPath}} {{outputPath}}').compile('', { ext: 'c', symbol: 'operator<' });
    expect(outcome.kind).toBe('ok');
  });

  it('requires a symbol when the template takes one', async () => {
    await expect(runner('cp {{inputPath}} {{outputPath}} # {{symbol}}').compile('', { ext: 'c' })).rejects.toThrow(
      TypeError,
    );
  });

  it('names the source file after its extension', async () => {
    const r = runner('basename {{inputPath}} > {{outputPath}}');
    using outcome = await r.compile('', { ext: 'cpp' });
    expect(text(outcome)).toBe('cand.cpp\n');
    await expect(r.compile('', { ext: '.c' })).rejects.toThrow(TypeError);
  });
});

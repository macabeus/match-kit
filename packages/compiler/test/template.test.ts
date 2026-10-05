// The command template: which placeholders it takes, and what reaches the shell.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { TemplateError, createRunner } from '../src/index.js';

describe('createRunner', () => {
  it('refuses a template without {{inputPath}} or {{outputPath}}', () => {
    expect(() => createRunner('cc -c {{inputPath}}')).toThrow(TemplateError);
    expect(() => createRunner('cc -c {{inputPath}}')).toThrow(
      'compile command lacks {{outputPath}}: cc -c {{inputPath}}',
    );
    expect(() => createRunner('true')).toThrow('compile command lacks {{inputPath}} and {{outputPath}}: true');
  });

  it('names an unknown placeholder', () => {
    expect(() => createRunner('cc {{cflags}} {{inputPath}} -o {{outputPath}}')).toThrow(
      'compile command has an unknown placeholder {{cflags}} (known: {{inputPath}}, {{outputPath}}, {{functionName}}, {{symbol}})',
    );
  });

  it('keeps the template it was created with', () => {
    expect(createRunner('cp {{inputPath}} {{outputPath}}').template).toBe('cp {{inputPath}} {{outputPath}}');
  });
});

describe('the rendered command', () => {
  it('fills {{symbol}} and {{functionName}} with the same symbol', () => {
    using scratch = createRunner(
      'printf "%s %s" {{symbol}} {{functionName}} > {{outputPath}} # {{inputPath}}',
    ).scratch();
    const outcome = scratch.compileSync('', { ext: 'c', symbol: 'Foo_Bar' });
    expect(outcome.kind).toBe('ok');
    expect(readFileSync(outcome.kind === 'ok' ? outcome.object : '', 'utf8')).toBe('Foo_Bar Foo_Bar');
  });

  it('leaves the quoting to the template', () => {
    using scratch = createRunner(
      'cp "{{inputPath}}" "{{outputPath}}.tmp" && mv {{outputPath}}.tmp {{outputPath}}',
    ).scratch();
    const outcome = scratch.compileSync('int x;', { ext: 'c' });
    expect(outcome.kind === 'ok' && readFileSync(outcome.object, 'utf8')).toBe('int x;');
  });

  it('refuses a symbol the shell would read as more than a word', () => {
    using scratch = createRunner('cp {{inputPath}} {{outputPath}} # {{symbol}}').scratch();
    expect(() => scratch.compileSync('', { ext: 'c', symbol: 'f; rm -rf ~' })).toThrow(
      'the symbol name contains shell-unsafe characters, refusing to substitute: "f; rm -rf ~"',
    );
  });

  it('rejects the async compile of a shell-unsafe symbol', async () => {
    await using runner = createRunner('cp {{inputPath}} {{outputPath}} # {{symbol}}');
    await expect(runner.scratch().compile('', { ext: 'c', symbol: '$(id)' })).rejects.toThrow('shell-unsafe');
  });

  it('accepts any symbol when the template takes none', () => {
    using scratch = createRunner('cp {{inputPath}} {{outputPath}}').scratch();
    expect(scratch.compileSync('', { ext: 'c', symbol: 'operator<' }).kind).toBe('ok');
  });

  it('requires a symbol when the template takes one', () => {
    using scratch = createRunner('cp {{inputPath}} {{outputPath}} # {{functionName}}').scratch();
    expect(() => scratch.compileSync('', { ext: 'c' })).toThrow(TypeError);
  });

  it('names the source file after its extension', () => {
    using scratch = createRunner('basename {{inputPath}} > {{outputPath}}').scratch();
    const outcome = scratch.compileSync('', { ext: 'cpp' });
    expect(outcome.kind === 'ok' && readFileSync(outcome.object, 'utf8')).toBe('cand.cpp\n');
    expect(() => scratch.compileSync('', { ext: '.c' })).toThrow(TypeError);
  });
});

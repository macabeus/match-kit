// What a compile comes to, read the same way by `compileSync` and `compile`.
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { type Outcome, type Runner, type RunnerOptions, createRunner, isStable } from '../src/index.js';

const SCRATCH = mkdtempSync(join(tmpdir(), 'match-kit-compiler-'));
const RUNNERS: Runner[] = [];
afterAll(async () => {
  await Promise.all(RUNNERS.map((runner) => runner.dispose()));
  rmSync(SCRATCH, { recursive: true, force: true });
});

/** A scratch whose objects live until the suite ends. */
function scratch(template: string, options: RunnerOptions) {
  const runner = createRunner(template, options);
  RUNNERS.push(runner);
  return runner.scratch();
}

const runners = {
  compileSync: (template: string, source = 'int x;\n', options: RunnerOptions = {}): Promise<Outcome> =>
    Promise.resolve(scratch(template, options).compileSync(source, { ext: 'c' })),
  compile: (template: string, source = 'int x;\n', options: RunnerOptions = {}): Promise<Outcome> =>
    scratch(template, options).compile(source, { ext: 'c' }),
};

describe.each(Object.entries(runners))('%s', (_, compile) => {
  it('returns the object the command wrote', async () => {
    const outcome = await compile('cp {{inputPath}} {{outputPath}}', 'int f(void);\n');
    expect(outcome.kind).toBe('ok');
    expect(outcome.kind === 'ok' && readFileSync(outcome.object, 'utf8')).toBe('int f(void);\n');
  });

  it('runs the command in cwd', async () => {
    const outcome = await compile('pwd > {{outputPath}} # {{inputPath}}', '', { cwd: SCRATCH });
    expect(outcome.kind === 'ok' && readFileSync(outcome.object, 'utf8').trim()).toBe(realpathSync(SCRATCH));
  });

  it('rejects with the exit code and the compiler stderr', async () => {
    const outcome = await compile('echo "{{inputPath}}:1: error: boom" >&2; exit 3; cp {{inputPath}} {{outputPath}}');
    expect(outcome).toEqual({
      kind: 'rejected',
      command: 'echo "<scratch>/cand.c:1: error: boom" >&2; exit 3; cp <scratch>/cand.c <scratch>/cand.o',
      exitCode: 3,
      output: '<scratch>/cand.c:1: error: boom',
    });
  });

  it('reads stdout when stderr is empty', async () => {
    const outcome = await compile('echo "line 1: error"; false # {{inputPath}} {{outputPath}}');
    expect(outcome.kind !== 'ok' && outcome.kind !== 'spawn-failed' && outcome.output).toBe('line 1: error');
  });

  it('rejects when a middle step fails and the last step succeeds', async () => {
    // gcc 2.x exits nonzero on an error yet writes a partial .s, so a later `as` step would succeed
    const outcome = await compile('false; cp {{inputPath}} {{outputPath}}');
    expect(outcome.kind).toBe('rejected');
  });

  it('reports an exit 0 that wrote no object', async () => {
    const outcome = await compile('true {{inputPath}} {{outputPath}}');
    expect(outcome).toEqual({ kind: 'no-object', command: 'true <scratch>/cand.c <scratch>/cand.o', output: '' });
  });

  it('reports a compiler a signal killed as killed, not rejected', async () => {
    // the shell reports its killed child as exit 128 + 9
    const outcome = await compile("sh -c 'kill -9 $$'; cp {{inputPath}} {{outputPath}}");
    expect(outcome).toMatchObject({ kind: 'killed', exitCode: 137 });
  });

  it('reports a killed shell as killed with no exit code', async () => {
    const outcome = await compile('kill -9 $$ # {{inputPath}} {{outputPath}}');
    expect(outcome).toMatchObject({ kind: 'killed', exitCode: null });
  });

  it('reports a shell that cannot start', async () => {
    const outcome = await compile('cp {{inputPath}} {{outputPath}}', '', { cwd: join(SCRATCH, 'missing') });
    expect(outcome.kind).toBe('spawn-failed');
  });

  it('keeps maxOutputBytes of the output', async () => {
    const outcome = await compile('yes error | head -c 100000 >&2; false # {{inputPath}} {{outputPath}}', '', {
      maxOutputBytes: 12,
    });
    expect(outcome.kind === 'rejected' && outcome.output).toBe('error\nerror\n\n... (truncated)');
  });

  it('keeps all of the output by default', async () => {
    const outcome = await compile('yes error | head -c 100000 >&2; false # {{inputPath}} {{outputPath}}');
    expect(outcome.kind === 'rejected' && outcome.output.length).toBe(100_000);
  });
});

describe('isStable', () => {
  it('holds for the compiler answers and fails for the interrupted compiles', async () => {
    const kinds = await Promise.all(
      [
        'cp {{inputPath}} {{outputPath}}',
        'false {{inputPath}} {{outputPath}}',
        'true {{inputPath}} {{outputPath}}',
        'kill -9 $$ # {{inputPath}} {{outputPath}}',
      ].map((template) => runners.compile(template)),
    );
    expect(kinds.map((outcome) => [outcome.kind, isStable(outcome)])).toEqual([
      ['ok', true],
      ['rejected', true],
      ['no-object', true],
      ['killed', false],
    ]);
    expect(isStable({ kind: 'aborted', command: '', output: '' })).toBe(false);
    expect(isStable({ kind: 'spawn-failed', command: '', message: '' })).toBe(false);
  });
});

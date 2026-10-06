// What a compile comes to.
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

/** One compile, its object kept until the suite ends. */
const compile = (template: string, source = 'int x;\n', options: RunnerOptions = {}): Promise<Outcome> => {
  const runner = createRunner(template, options);
  RUNNERS.push(runner);
  return runner.compile(source, { ext: 'c' });
};

describe('Runner.compile', () => {
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
    expect(outcome).toMatchObject({
      kind: 'rejected',
      command: 'echo "<compile-dir>/cand.c:1: error: boom" >&2; exit 3; cp <compile-dir>/cand.c <compile-dir>/cand.o',
      exitCode: 3,
      output: '<compile-dir>/cand.c:1: error: boom',
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
    expect(outcome).toMatchObject({
      kind: 'no-object',
      command: 'true <compile-dir>/cand.c <compile-dir>/cand.o',
      output: '',
    });
  });

  it('reports a program a signal ended from outside as killed, naming the signal', async () => {
    // the shell reports a child that signal n ended as exit 128 + n
    const outcome = await compile("sh -c 'kill -KILL $$'; cp {{inputPath}} {{outputPath}}");
    expect(outcome).toMatchObject({ kind: 'killed', signal: 'SIGKILL' });
  });

  it('reports a killed shell as killed, with the signal Node names', async () => {
    const outcome = await compile('kill -TERM $$ # {{inputPath}} {{outputPath}}');
    expect(outcome).toMatchObject({ kind: 'killed', signal: 'SIGTERM' });
  });

  it('reports a crash as crashed, not as killed or rejected', async () => {
    const midway = await compile("sh -c 'kill -SEGV $$'; cp {{inputPath}} {{outputPath}}");
    expect(midway).toMatchObject({ kind: 'crashed', signal: 'SIGSEGV' });
    const last = await compile("sh -c 'kill -ABRT $$' # {{inputPath}} {{outputPath}}");
    expect(last).toMatchObject({ kind: 'crashed', signal: 'SIGABRT' });
  });

  it('reads an exit above 128 that is no outside or crash signal as the program’s own', async () => {
    const outcome = await compile("sh -c 'exit 255'; cp {{inputPath}} {{outputPath}}");
    expect(outcome).toMatchObject({ kind: 'rejected', exitCode: 255 });
  });

  it('reports a program that did not run as not-run', async () => {
    expect(await compile('no-such-compiler-match-kit {{inputPath}} {{outputPath}}')).toMatchObject({
      kind: 'not-run',
      exitCode: 127,
    });
    // a container runtime's own failure, such as `docker run` without a daemon
    expect(await compile('exit 125 # {{inputPath}} {{outputPath}}')).toMatchObject({ kind: 'not-run', exitCode: 125 });
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
        "sh -c 'kill -SEGV $$'; true {{inputPath}} {{outputPath}}",
        'kill -9 $$ # {{inputPath}} {{outputPath}}',
        'exit 127 # {{inputPath}} {{outputPath}}',
      ].map((template) => compile(template)),
    );
    expect(kinds.map((outcome) => [outcome.kind, isStable(outcome)])).toEqual([
      ['ok', true],
      ['rejected', true],
      ['no-object', true],
      ['crashed', false],
      ['killed', false],
      ['not-run', false],
    ]);
    expect(isStable({ kind: 'aborted', command: '', output: '' })).toBe(false);
    expect(isStable({ kind: 'spawn-failed', command: '', message: '' })).toBe(false);
  });
});

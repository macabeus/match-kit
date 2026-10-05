// Cancelling async compiles with the runner's AbortSignal.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { createRunner } from '../src/index.js';

const SCRATCH = mkdtempSync(join(tmpdir(), 'match-kit-compiler-abort-'));
afterAll(() => rmSync(SCRATCH, { recursive: true, force: true }));

const processGroup = (pid: number | string): string =>
  execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)])
    .toString()
    .trim();

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

async function until(condition: () => boolean): Promise<void> {
  for (let waited = 0; !condition(); waited += 20) {
    if (waited > 5000) {
      throw new Error('timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('RunnerOptions.signal', () => {
  it('aborts a compile without running it when the signal has already fired', async () => {
    const ran = join(SCRATCH, 'ran');
    await using runner = createRunner(`touch ${ran}; cp {{inputPath}} {{outputPath}}`, { signal: AbortSignal.abort() });
    expect(await runner.compile('int f;', { ext: 'c' })).toMatchObject({ kind: 'aborted' });
    expect(existsSync(ran)).toBe(false);
  });

  it('kills the whole process group, so the compiler under the shell ends too', async () => {
    const pidFile = join(SCRATCH, 'compiler.pid');
    const abort = new AbortController();
    await using runner = createRunner(`sleep 30 & echo $! > ${pidFile}; wait; cp {{inputPath}} {{outputPath}}`, {
      signal: abort.signal,
    });
    const compile = runner.compile('int f;', { ext: 'c' });
    await until(() => existsSync(pidFile) && readFileSync(pidFile, 'utf8').endsWith('\n'));
    const compiler = Number(readFileSync(pidFile, 'utf8'));
    abort.abort();
    expect(await compile).toMatchObject({ kind: 'aborted' });
    await until(() => !alive(compiler));
  });

  it('runs a compile in its own process group only when there is a signal', async () => {
    const template = 'ps -o pgid= -p $$ > {{outputPath}} # {{inputPath}}';
    const group = async (runner: ReturnType<typeof createRunner>): Promise<string> => {
      const outcome = await runner.compile('', { ext: 'c' });
      return outcome.kind === 'ok' ? readFileSync(outcome.object, 'utf8').trim() : outcome.kind;
    };
    await using plain = createRunner(template);
    await using cancellable = createRunner(template, { signal: new AbortController().signal });
    expect(await group(plain)).toBe(processGroup(process.pid));
    expect(await group(cancellable)).not.toBe(processGroup(process.pid));
  });
});

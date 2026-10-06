// Where compiles run: a fresh directory per compile, removed when its outcome is disposed.
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { type Outcome, createRunner } from '../src/index.js';

const object = (outcome: Outcome): string => {
  if (outcome.kind !== 'ok') {
    throw new Error(`the compile failed: ${JSON.stringify(outcome)}`);
  }
  return outcome.object;
};

describe('Runner.compile', () => {
  it('compiles each candidate in a fresh, empty directory', async () => {
    await using runner = createRunner('test ! -e {{outputPath}} && cp {{inputPath}} {{outputPath}}');
    using first = await runner.compile('int f;', { ext: 'c' });
    using second = await runner.compile('int g;', { ext: 'c' });
    expect(dirname(object(second))).not.toBe(dirname(object(first)));
    expect(readFileSync(object(first), 'utf8')).toBe('int f;');
    expect(readFileSync(object(second), 'utf8')).toBe('int g;');
  });

  it('keeps the object until its outcome is disposed', async () => {
    await using runner = createRunner('cp {{inputPath}} {{outputPath}}');
    let path: string;
    {
      using outcome = await runner.compile('int f;', { ext: 'c' });
      path = object(outcome);
      expect(existsSync(path)).toBe(true);
    }
    expect(existsSync(dirname(path))).toBe(false);
  });

  it('removes a failed compile’s directory at once', async () => {
    const note = join(mkdtempSync(join(tmpdir(), 'match-kit-compiler-note-')), 'dir');
    await using runner = createRunner(`dirname {{outputPath}} > ${note}; false # {{inputPath}}`);
    expect((await runner.compile('int f;', { ext: 'c' })).kind).toBe('rejected');
    expect(existsSync(readFileSync(note, 'utf8').trim())).toBe(false);
  });

  it('runs compiles at the same time', async () => {
    await using runner = createRunner('sleep 0.2; cp {{inputPath}} {{outputPath}}');
    const sources = ['int a;', 'int b;', 'int c;', 'int d;'];
    const started = performance.now();
    const outcomes = await Promise.all(sources.map((source) => runner.compile(source, { ext: 'c' })));
    expect(outcomes.map((outcome) => readFileSync(object(outcome), 'utf8'))).toEqual(sources);
    expect(performance.now() - started).toBeLessThan(800);
  });
});

describe('Runner.dispose', () => {
  it('waits for the compiles in flight, then removes every directory not yet disposed', async () => {
    const runner = createRunner('sleep 0.2; cp {{inputPath}} {{outputPath}}');
    const kept = object(await runner.compile('int f;', { ext: 'c' }));
    const compiling = runner.compile('int g;', { ext: 'c' });
    await runner.dispose();
    expect(existsSync(dirname(object(await compiling)))).toBe(false);
    expect(existsSync(dirname(kept))).toBe(false);
  });

  it('refuses work once disposed', async () => {
    const runner = createRunner('cp {{inputPath}} {{outputPath}}');
    await runner.dispose();
    await expect(runner.compile('int f;', { ext: 'c' })).rejects.toThrow('this runner is disposed');
  });
});

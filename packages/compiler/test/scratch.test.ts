// Where compiles run: a fresh directory per compile, one compile at a time per scratch.
import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';

import { type Outcome, createRunner } from '../src/index.js';

const object = (outcome: Outcome): string => {
  if (outcome.kind !== 'ok') {
    throw new Error(`the compile failed: ${JSON.stringify(outcome)}`);
  }
  return outcome.object;
};

describe('Scratch', () => {
  it('compiles each candidate in a fresh, empty directory and removes the previous one', async () => {
    await using runner = createRunner('test ! -e {{outputPath}} && cp {{inputPath}} {{outputPath}}');
    const scratch = runner.scratch();
    const first = object(await scratch.compile('int f;', { ext: 'c' }));
    const second = object(await scratch.compile('int g;', { ext: 'c' }));
    expect(dirname(second)).not.toBe(dirname(first));
    expect(existsSync(dirname(first))).toBe(false);
    expect(readFileSync(second, 'utf8')).toBe('int g;');
  });

  it('refuses a second compile while one is in flight', async () => {
    await using runner = createRunner('sleep 0.2; cp {{inputPath}} {{outputPath}}');
    const scratch = runner.scratch();
    const first = scratch.compile('int f;', { ext: 'c' });
    await expect(scratch.compile('int g;', { ext: 'c' })).rejects.toThrow('this scratch is already compiling');
    expect((await first).kind).toBe('ok');
    expect((await scratch.compile('int g;', { ext: 'c' })).kind).toBe('ok');
  });

  it('runs compiles in separate scratches at the same time', async () => {
    await using runner = createRunner('sleep 0.2; cp {{inputPath}} {{outputPath}}');
    const sources = ['int a;', 'int b;', 'int c;', 'int d;'];
    const started = performance.now();
    const outcomes = await Promise.all(sources.map((source) => runner.scratch().compile(source, { ext: 'c' })));
    expect(outcomes.map((outcome) => readFileSync(object(outcome), 'utf8'))).toEqual(sources);
    expect(performance.now() - started).toBeLessThan(800);
  });

  it('removes its directory when disposed', async () => {
    const runner = createRunner('cp {{inputPath}} {{outputPath}}');
    let path: string;
    {
      using scratch = runner.scratch();
      path = object(await scratch.compile('int f;', { ext: 'c' }));
    }
    expect(existsSync(dirname(path))).toBe(false);
  });
});

describe('Runner', () => {
  it('waits for the compiles in flight, then removes every scratch', async () => {
    const runner = createRunner('sleep 0.2; cp {{inputPath}} {{outputPath}}');
    const compile = runner.scratch().compile('int f;', { ext: 'c' });
    await runner.dispose();
    const path = object(await compile);
    expect(existsSync(dirname(path))).toBe(false);
  });

  it('refuses work once disposed', async () => {
    const runner = createRunner('cp {{inputPath}} {{outputPath}}');
    const scratch = runner.scratch();
    await runner.dispose();
    expect(() => runner.scratch()).toThrow('this runner is disposed');
    await expect(scratch.compile('int f;', { ext: 'c' })).rejects.toThrow('this runner is disposed');
  });
});

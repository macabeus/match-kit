import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type Paths, outcome } from './process/outcome.js';
import { run } from './process/run.js';
import { checkTemplate, render } from './template/template.js';
import type { CompileOptions, Outcome, Runner, RunnerOptions, Scratch } from './types.js';

const EXT = /^[A-Za-z0-9]+$/;

class CompileRunner implements Runner {
  readonly template: string;
  readonly options: RunnerOptions;
  readonly takesSymbol: boolean;
  readonly #scratches = new Set<CompileScratch>();
  readonly #inFlight = new Set<Promise<Outcome>>();
  #disposed = false;

  constructor(template: string, options: RunnerOptions) {
    this.takesSymbol = checkTemplate(template).takesSymbol;
    this.template = template;
    this.options = options;
  }

  scratch(): Scratch {
    this.assertOpen();
    const scratch = new CompileScratch(this, () => this.#scratches.delete(scratch));
    this.#scratches.add(scratch);
    return scratch;
  }

  track(compile: Promise<Outcome>): Promise<Outcome> {
    this.#inFlight.add(compile);
    void compile.finally(() => this.#inFlight.delete(compile)).catch(() => {});
    return compile;
  }

  assertOpen(): void {
    if (this.#disposed) {
      throw new Error('this runner is disposed');
    }
  }

  async dispose(): Promise<void> {
    this.#disposed = true;
    await Promise.allSettled([...this.#inFlight]);
    for (const scratch of [...this.#scratches]) {
      scratch.dispose();
    }
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.dispose();
  }
}

class CompileScratch implements Scratch {
  readonly #runner: CompileRunner;
  readonly #forget: () => void;
  #dir: string | undefined;
  #busy = false;
  #disposed = false;

  constructor(runner: CompileRunner, forget: () => void) {
    this.#runner = runner;
    this.#forget = forget;
  }

  async compile(source: string, options: CompileOptions): Promise<Outcome> {
    const { command, paths } = this.#stage(source, options);
    const { cwd, signal, maxOutputBytes = Infinity } = this.#runner.options;
    if (signal?.aborted) {
      this.#busy = false;
      return { kind: 'aborted', command: command.split(paths.dir).join('<scratch>'), output: '' };
    }
    return this.#runner.track(
      run(command, cwd, paths.stdout, paths.stderr, signal)
        .then((exit) => outcome(exit, command, paths, maxOutputBytes))
        .finally(() => (this.#busy = false)),
    );
  }

  /** A fresh directory holding the source, and the command that compiles it. */
  #stage(source: string, options: CompileOptions): { command: string; paths: Paths } {
    this.#runner.assertOpen();
    if (this.#disposed) {
      throw new Error('this scratch is disposed');
    }
    if (this.#busy) {
      throw new Error('this scratch is already compiling: give each compile in flight its own scratch');
    }
    if (!EXT.test(options.ext)) {
      throw new TypeError(
        `the source extension must be letters and digits, without the dot: ${JSON.stringify(options.ext)}`,
      );
    }
    if (this.#runner.takesSymbol && options.symbol === undefined) {
      throw new TypeError(`the compile command takes the symbol, and none was given: ${this.#runner.template}`);
    }
    // A fresh path each compile: a `docker run` template bind-mounts the directory, and a recreated
    // directory at the same path can resolve to the stale mount, failing the object's write.
    const dir = mkdtempSync(join(tmpdir(), 'match-kit-compile-'));
    const previous = this.#dir;
    this.#dir = dir;
    if (previous !== undefined) {
      rmSync(previous, { recursive: true, force: true });
    }
    const input = join(dir, `cand.${options.ext}`);
    const paths: Paths = {
      dir,
      object: join(dir, 'cand.o'),
      stdout: join(dir, 'cand.stdout'),
      stderr: join(dir, 'cand.stderr'),
    };
    const command = render(this.#runner.template, {
      inputPath: input,
      outputPath: paths.object,
      symbol: this.#runner.takesSymbol ? options.symbol : undefined,
    });
    writeFileSync(input, source);
    this.#busy = true;
    return { command, paths };
  }

  dispose(): void {
    if (this.#busy) {
      throw new Error('this scratch is still compiling');
    }
    this.#disposed = true;
    this.#forget();
    if (this.#dir !== undefined) {
      rmSync(this.#dir, { recursive: true, force: true });
      this.#dir = undefined;
    }
  }

  [Symbol.dispose](): void {
    this.dispose();
  }
}

/** A runner for `template`. Throws a `TemplateError` when the template lacks a path or has an unknown placeholder. */
export function createRunner(template: string, options: RunnerOptions = {}): Runner {
  return new CompileRunner(template, options);
}

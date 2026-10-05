import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type Paths, outcome } from './process/outcome.js';
import { run } from './process/run.js';
import { checkTemplate, render } from './template/template.js';
import type { CompileOptions, Outcome, Result, Runner, RunnerOptions } from './types.js';

const EXT = /^[A-Za-z0-9]+$/;

class CompileRunner implements Runner {
  readonly template: string;
  readonly command: string;
  readonly #options: RunnerOptions;
  readonly #takesSymbol: boolean;
  /** The directories of compiles in flight, and of `ok` outcomes not yet disposed. */
  readonly #live = new Set<string>();
  readonly #inFlight = new Set<Promise<unknown>>();
  #disposed = false;

  constructor(template: string, options: RunnerOptions) {
    const { command, takesSymbol } = checkTemplate(template, options.flags);
    this.template = template;
    this.command = command;
    this.#options = options;
    this.#takesSymbol = takesSymbol;
  }

  compile(source: string, options: CompileOptions): Promise<Outcome> {
    const compiling = this.#compile(source, options);
    this.#inFlight.add(compiling);
    void compiling.finally(() => this.#inFlight.delete(compiling)).catch(() => {});
    return compiling;
  }

  async #compile(source: string, options: CompileOptions): Promise<Outcome> {
    if (this.#disposed) {
      throw new Error('this runner is disposed');
    }
    if (!EXT.test(options.ext)) {
      throw new TypeError(
        `the source extension must be letters and digits, without the dot: ${JSON.stringify(options.ext)}`,
      );
    }
    if (this.#takesSymbol && options.symbol === undefined) {
      throw new TypeError(`the compile command takes {{symbol}}, and none was given: ${this.template}`);
    }
    // A fresh path each compile: a `docker run` template bind-mounts the directory, and a recreated
    // directory at the same path can resolve to the stale mount, failing the object's write.
    const dir = mkdtempSync(join(tmpdir(), 'match-kit-compile-'));
    this.#live.add(dir);
    const remove = (): void => {
      if (this.#live.delete(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    };
    try {
      const paths: Paths = {
        dir,
        object: join(dir, 'cand.o'),
        stdout: join(dir, 'cand.stdout'),
        stderr: join(dir, 'cand.stderr'),
      };
      const input = join(dir, `cand.${options.ext}`);
      const command = render(this.command, {
        inputPath: input,
        outputPath: paths.object,
        symbol: this.#takesSymbol ? options.symbol : undefined,
      });
      writeFileSync(input, source);
      const { cwd, signal, maxOutputBytes = Infinity } = this.#options;
      const result: Result = signal?.aborted
        ? { kind: 'aborted', command: command.split(dir).join('<scratch>'), output: '' }
        : outcome(await run(command, cwd, paths.stdout, paths.stderr, signal), command, paths, maxOutputBytes);
      if (result.kind !== 'ok') {
        remove();
      }
      return { ...result, [Symbol.dispose]: remove };
    } catch (e) {
      remove();
      throw e;
    }
  }

  async dispose(): Promise<void> {
    this.#disposed = true;
    await Promise.allSettled([...this.#inFlight]);
    for (const dir of this.#live) {
      rmSync(dir, { recursive: true, force: true });
    }
    this.#live.clear();
  }

  [Symbol.asyncDispose](): Promise<void> {
    return this.dispose();
  }
}

/**
 * A runner for `template`. Throws a `TemplateError` when the template lacks a path, has an unknown
 * placeholder, or disagrees with `flags` about `{{flags}}`.
 */
export function createRunner(template: string, options: RunnerOptions = {}): Runner {
  return new CompileRunner(template, options);
}

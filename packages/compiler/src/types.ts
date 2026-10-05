export interface RunnerOptions {
  /** The directory the command runs in, such as the decomp.yaml's directory. Default: the working directory. */
  cwd?: string;
  /**
   * Cancels the async compiles: each one runs in its own process group, and an abort sends SIGTERM to
   * the whole group. Without a signal, a compile stays in the caller's process group, so a terminal's
   * Ctrl-C reaches the compiler too.
   */
  signal?: AbortSignal;
  /** The most bytes of stdout, and of stderr, an outcome keeps. Default: all of it. */
  maxOutputBytes?: number;
}

export interface CompileOptions {
  /** The source file's extension, without the dot: `c`, `cpp`, `p`, … */
  ext: string;
  /** The function the candidate defines: `{{symbol}}` and `{{functionName}}` in the command. */
  symbol?: string;
}

/**
 * What one compile came to. `command` and `output` read `<scratch>` for the scratch directory, so the
 * same failure reads the same on every run. `output` is the compiler's stderr, or its stdout when
 * stderr is empty, trimmed.
 */
export type Outcome =
  /** The command exited 0 and wrote its object. */
  | { kind: 'ok'; object: string }
  /** The command exited with `exitCode`, below 128: the compiler refused the candidate. */
  | { kind: 'rejected'; command: string; exitCode: number; output: string }
  /** The command exited 0 and wrote no object. */
  | { kind: 'no-object'; command: string; output: string }
  /** A signal ended the compile: the shell exited 128 + the signal's number, or `exitCode` is null when it killed the shell. */
  | { kind: 'killed'; command: string; exitCode: number | null; output: string }
  /** The runner's signal aborted the compile. */
  | { kind: 'aborted'; command: string; output: string }
  /** The shell did not start, such as when `cwd` is missing. */
  | { kind: 'spawn-failed'; command: string; message: string };

export interface Runner extends AsyncDisposable {
  /** The command template the runner was created with. */
  readonly template: string;
  /** A new scratch: one per worker, or per compile in flight. */
  scratch(): Scratch;
  /** Waits for the compiles in flight, then removes every scratch's directory. */
  dispose(): Promise<void>;
}

/**
 * Where one compile at a time runs. Each compile gets a fresh directory and removes the previous one,
 * so an object lives until this scratch's next compile.
 */
export interface Scratch extends Disposable {
  compile(source: string, options: CompileOptions): Promise<Outcome>;
  compileSync(source: string, options: CompileOptions): Outcome;
  /** Removes the scratch's directory. */
  dispose(): void;
}

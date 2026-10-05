export interface RunnerOptions {
  /** The directory the command runs in, such as the decomp.yaml's directory. Default: the working directory. */
  cwd?: string;
  /** The compiler's flags, which fill `{{flags}}` as shell words, quoted where the shell needs it. */
  flags?: readonly string[];
  /**
   * Cancels the compiles: each one runs in its own process group, and an abort sends SIGTERM to the
   * whole group. Without a signal, a compile stays in the caller's process group, so a terminal's
   * Ctrl-C reaches the compiler too.
   */
  signal?: AbortSignal;
  /** The most bytes of stdout, and of stderr, an outcome keeps. Default: all of it. */
  maxOutputBytes?: number;
}

export interface CompileOptions {
  /** The source file's extension, without the dot: `c`, `cpp`, `p`, … */
  ext: string;
  /** The function the candidate defines: `{{symbol}}` in the command. */
  symbol?: string;
}

/**
 * What one compile came to. `command` and `output` read `<scratch>` for the compile's directory, so the
 * same failure reads the same on every run. `output` is the compiler's stderr, or its stdout when stderr
 * is empty, trimmed.
 */
export type Result =
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

/**
 * A compile's `Result`. Each compile runs in a fresh directory; disposing the outcome removes it, and
 * with it an `ok` outcome's object.
 */
export type Outcome = Result & Disposable;

export interface Runner extends AsyncDisposable {
  /** The command template the runner was created with. */
  readonly template: string;
  /** The template with `{{flags}}` filled: what every compile substitutes its paths and symbol into. */
  readonly command: string;
  /** Compile `source` in a fresh directory. Any number of compiles may run at once. */
  compile(source: string, options: CompileOptions): Promise<Outcome>;
  /** Waits for the compiles in flight, then removes every outcome's directory not yet disposed. */
  dispose(): Promise<void>;
}

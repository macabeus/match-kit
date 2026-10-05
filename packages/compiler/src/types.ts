export interface RunnerOptions {
  /** The directory the command runs in, such as the decomp.yaml's directory. Default: the working directory. */
  cwd?: string;
  /** The compiler's flags, which fill `{{flags}}` as shell words, quoted where the shell needs it. */
  flags?: readonly string[];
  /**
   * Cancels the compiles: each runs in its own process group, and an abort sends SIGTERM to the group.
   * Without a signal, compiles stay in the caller's process group, which a terminal's Ctrl-C reaches.
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
  /** The command exited with `exitCode`: the compiler refused the candidate. */
  | { kind: 'rejected'; command: string; exitCode: number; output: string }
  /** The command exited 0 and wrote no object. */
  | { kind: 'no-object'; command: string; output: string }
  /** A program crashed with `signal`: SIGSEGV, SIGBUS, SIGILL, SIGFPE or SIGABRT. */
  | { kind: 'crashed'; command: string; signal: string; output: string }
  /** `signal` ended the compile from outside, such as SIGKILL from an out-of-memory killer. */
  | { kind: 'killed'; command: string; signal: string; output: string }
  /** A program did not run: exit 126 or 127 from the shell, or 125 from a container runtime. */
  | { kind: 'not-run'; command: string; exitCode: number; output: string }
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

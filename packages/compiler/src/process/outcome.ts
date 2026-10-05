import { closeSync, existsSync, fstatSync, openSync, readSync } from 'node:fs';
import { constants } from 'node:os';

import type { Result } from '../types.js';
import type { Exit } from './run.js';

export interface Paths {
  dir: string;
  object: string;
  stdout: string;
  stderr: string;
}

/** The file's text, cut to `maxBytes`. */
function readOutput(path: string, maxBytes: number): string {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    const bytes = new Uint8Array(Math.min(size, maxBytes));
    readSync(fd, bytes, 0, bytes.length, 0);
    const text = new TextDecoder().decode(bytes);
    return size > maxBytes ? `${text}\n... (truncated)` : text;
  } finally {
    closeSync(fd);
  }
}

// A shell reports a child that signal n ended as exit 128 + n, which a program can also exit with on
// purpose. So only the signals that end a compile from outside, and the signals of a crash, are read
// off the exit status; any other status is the program's own.
const OUTSIDE = ['SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGKILL', 'SIGTERM'] as const;
const CRASH = ['SIGSEGV', 'SIGBUS', 'SIGILL', 'SIGFPE', 'SIGABRT'] as const;
const relayed = (status: number): string | undefined =>
  [...OUTSIDE, ...CRASH].find((name) => status - 128 === constants.signals[name]);
const isCrash = (signal: string): boolean => (CRASH as readonly string[]).includes(signal);

// 126 and 127 are the shell's "cannot execute" and "not found"; container runtimes (`docker run`,
// `podman run`) add 125 for a failure of their own.
const NOT_RUN = [125, 126, 127];

/** What the shell's exit means for the compile. */
export function outcome(exit: Exit, command: string, paths: Paths, maxOutputBytes: number): Result {
  const scrub = (text: string): string => text.split(paths.dir).join('<scratch>');
  if ('spawnError' in exit) {
    return { kind: 'spawn-failed', command: scrub(command), message: scrub(exit.spawnError.message) };
  }
  const { status, aborted } = exit;
  if (status === 0 && !aborted && existsSync(paths.object)) {
    return { kind: 'ok', object: paths.object };
  }
  const output = scrub((readOutput(paths.stderr, maxOutputBytes) || readOutput(paths.stdout, maxOutputBytes)).trim());
  const failed = { command: scrub(command), output };
  if (aborted) {
    return { kind: 'aborted', ...failed };
  }
  // Null: the signal ended the shell itself, and Node names it.
  const signal = status === null ? (exit.signal ?? 'an unknown signal') : relayed(status);
  if (signal !== undefined) {
    return { kind: isCrash(signal) ? 'crashed' : 'killed', ...failed, signal };
  }
  if (status === null || status === 0) {
    return { kind: 'no-object', ...failed };
  }
  if (NOT_RUN.includes(status)) {
    return { kind: 'not-run', ...failed, exitCode: status };
  }
  return { kind: 'rejected', ...failed, exitCode: status };
}

/** Whether the outcome is the compiler's own answer, the same on every run, and so safe to cache. */
export function isStable(outcome: Result): boolean {
  return outcome.kind === 'ok' || outcome.kind === 'rejected' || outcome.kind === 'no-object';
}

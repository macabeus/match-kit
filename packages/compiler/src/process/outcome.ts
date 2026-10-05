import { closeSync, existsSync, fstatSync, openSync, readSync } from 'node:fs';

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
  // `sh` reports a child a signal killed as exit 128 + the signal's number.
  if (status === null || status >= 128) {
    return { kind: 'killed', ...failed, exitCode: status };
  }
  if (status !== 0) {
    return { kind: 'rejected', ...failed, exitCode: status };
  }
  return { kind: 'no-object', ...failed };
}

/** Whether the outcome is the compiler's own answer, the same on every run, and so safe to cache. */
export function isStable(outcome: Result): boolean {
  return outcome.kind === 'ok' || outcome.kind === 'rejected' || outcome.kind === 'no-object';
}

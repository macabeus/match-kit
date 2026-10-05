import { spawn, spawnSync } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';

/** How the shell ended. */
export type Exit = { status: number | null; aborted: boolean } | { spawnError: Error };

// stdout and stderr go to files, not pipes: a Wine-backed compiler writing through a pipe costs
// about 5 s per compile on macOS.
function withOutputFiles<T>(stdoutPath: string, stderrPath: string, run: (stdout: number, stderr: number) => T): T {
  const stdout = openSync(stdoutPath, 'w');
  try {
    const stderr = openSync(stderrPath, 'w');
    try {
      return run(stdout, stderr);
    } finally {
      closeSync(stderr);
    }
  } finally {
    closeSync(stdout);
  }
}

/** Run `command` under `sh -ec`, so any failed step fails the compile. */
export function runSync(command: string, cwd: string | undefined, stdoutPath: string, stderrPath: string): Exit {
  return withOutputFiles(stdoutPath, stderrPath, (stdout, stderr) => {
    const result = spawnSync('sh', ['-ec', command], { cwd, stdio: ['ignore', stdout, stderr] });
    return result.error ? { spawnError: result.error } : { status: result.status, aborted: false };
  });
}

/** `runSync`'s async twin. With a `signal`, the shell leads its own process group, and an abort ends the group. */
export async function run(
  command: string,
  cwd: string | undefined,
  stdoutPath: string,
  stderrPath: string,
  signal: AbortSignal | undefined,
): Promise<Exit> {
  const stdout = openSync(stdoutPath, 'w');
  const stderr = openSync(stderrPath, 'w');
  try {
    const child = spawn('sh', ['-ec', command], {
      cwd,
      stdio: ['ignore', stdout, stderr],
      detached: signal !== undefined,
    });
    let aborted = false;
    const abort = () => {
      aborted = true;
      try {
        process.kill(-child.pid!, 'SIGTERM');
      } catch {
        // the group has already exited
      }
    };
    return await new Promise<Exit>((resolve) => {
      child.once('error', (spawnError) => resolve({ spawnError }));
      child.once('spawn', () => {
        if (signal?.aborted) {
          abort();
        }
        signal?.addEventListener('abort', abort, { once: true });
      });
      child.once('close', (status) => {
        signal?.removeEventListener('abort', abort);
        resolve({ status, aborted });
      });
    });
  } finally {
    closeSync(stdout);
    closeSync(stderr);
  }
}

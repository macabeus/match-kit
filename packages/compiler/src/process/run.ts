import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';

/** How the shell ended. */
export type Exit = { status: number | null; signal: NodeJS.Signals | null; aborted: boolean } | { spawnError: Error };

/**
 * Run `command` under `sh -ec`, so any failed step fails the compile, with stdout and stderr in files.
 * With a `signal`, the shell leads its own process group, and an abort ends the group.
 */
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
      child.once('close', (status, killedBy) => {
        signal?.removeEventListener('abort', abort);
        resolve({ status, signal: killedBy, aborted });
      });
    });
  } finally {
    closeSync(stdout);
    closeSync(stderr);
  }
}

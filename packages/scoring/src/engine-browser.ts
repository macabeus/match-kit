// The engine for browsers and web workers.
import type { Engine } from './engine.js';

let loading: Promise<Engine> | undefined;

/** The objdiff engine, loaded once per page or worker and shared by every scorer. */
export function loadEngine(): Promise<Engine> {
  loading ??= load().catch((error: unknown) => {
    loading = undefined;
    throw error;
  });
  return loading;
}

async function load(): Promise<Engine> {
  const engine = await import('objdiff-wasm');
  engine.init('error');
  return engine;
}

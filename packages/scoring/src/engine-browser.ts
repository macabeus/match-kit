// The engine for browsers and web workers. No fetch patch is needed: a bundler (Vite) rewrites
// objdiff-wasm's `new URL('./objdiff.core.wasm', import.meta.url)` to a served asset.
import type { Engine } from './engine.js';

let loading: Promise<Engine> | undefined;

/** The objdiff engine, loaded once per page or worker and shared by every scorer. */
export function loadEngine(): Promise<Engine> {
  loading ??= load().catch((error: unknown) => {
    // Forgotten so a later call imports again, though the runtime may cache a failed evaluation.
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

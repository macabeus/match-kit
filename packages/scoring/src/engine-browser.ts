// The engine for browsers and web workers. `fetch` and `WebAssembly.compileStreaming` are native
// there, and a bundler (Vite) rewrites objdiff-wasm's `new URL('./objdiff.core.wasm', import.meta.url)`
// to a served asset, so no patch is needed.
import type { Engine } from './engine.js';

let loading: Promise<Engine> | undefined;

/** The objdiff engine, loaded once per page or worker and shared by every scorer. */
export function loadEngine(): Promise<Engine> {
  loading ??= load().catch((error: unknown) => {
    // not remembered here, so a later call imports again; a module whose evaluation failed may
    // still fail the same way, since the runtime caches that failure
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

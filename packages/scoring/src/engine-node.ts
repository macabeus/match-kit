// The engine for Node and Bun.
//
// objdiff-wasm fetches its sibling `objdiff.core.wasm` by file:// URL while its module initializes
// (a top-level await). Node's fetch does not read file:// URLs, so the import goes through a fetch
// patch that serves that one URL from disk. The patch is scoped to the import and restored before
// anything else runs. Bun's fetch reads file:// URLs on its own; the patch is harmless there.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Engine } from './engine.js';

let loading: Promise<Engine> | undefined;

/** The objdiff engine, loaded once per process and shared by every scorer. */
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
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = input.toString();
    if (url.startsWith('file://') && url.includes('objdiff.core.wasm')) {
      const bytes = readFileSync(fileURLToPath(url));
      return new Response(bytes, { headers: { 'content-type': 'application/wasm' } });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  try {
    const engine = await import('objdiff-wasm');
    engine.init('error');
    return engine;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

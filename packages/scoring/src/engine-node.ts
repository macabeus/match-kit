// The engine for Node and Bun. objdiff-wasm fetches its sibling `objdiff.core.wasm` by file:// URL
// in its top-level await, and Node's fetch cannot read file:// URLs, so the import runs under a
// fetch patch that serves that one file from disk. Bun's fetch reads file:// URLs itself; the patch
// is harmless there.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Engine } from './engine.js';

let loading: Promise<Engine> | undefined;

/** The objdiff engine, loaded once per process and shared by every scorer. */
export function loadEngine(): Promise<Engine> {
  loading ??= load().catch((error: unknown) => {
    // Forgotten so a later call imports again, though the runtime may cache a failed evaluation.
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

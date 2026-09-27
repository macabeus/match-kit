// The engine for Node and Bun. objdiff-wasm fetches `objdiff.core.wasm` by file:// URL while it
// loads, which Node's fetch cannot read, so the import runs under a fetch patch that serves that
// file from disk.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Engine } from '../types.js';

let loading: Promise<Engine> | undefined;

/** The objdiff engine, loaded once per process and shared by every scorer. */
export function loadEngine(): Promise<Engine> {
  loading ??= load().catch((error: unknown) => {
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

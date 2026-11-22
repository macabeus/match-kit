import type { SymbolResolver } from '../../src/armv4t.js';

// A resolver for isa tests: every address is named `_XXXXXXXX`, and that name maps back.

export const LABELS: SymbolResolver = {
  labelFor: (addr) => `_${addr.toString(16).toUpperCase().padStart(8, '0')}`,
  addressOf: (name) => (/^_[0-9A-F]{8}$/.test(name) ? Number.parseInt(name.slice(1), 16) : undefined),
};

/** A resolver that knows no address. */
export const NO_LABELS: SymbolResolver = { labelFor: () => undefined, addressOf: () => undefined };

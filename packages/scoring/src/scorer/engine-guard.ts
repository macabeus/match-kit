// Every engine call and every long-lived engine handle goes through here.
import type { Engine } from '../types.js';
import { EngineFailedError, SymbolNotFoundError, UndiffableError } from './errors.js';
import { PROBE_OBJECT_BASE64 } from './probe-object.js';

/** Engines that failed, shared by every scorer on the same wasm instance. */
const failedEngines = new WeakSet<Engine>();

/**
 * Each engine's long-lived handles (scorer configs, parsed targets), held weakly. They are all
 * released when the engine fails: left to the engine's FinalizationRegistry, their drop would trap
 * on the dead instance as an uncaught exception.
 */
const heldHandles = new WeakMap<Engine, Set<WeakRef<object>>>();

export function hold(engine: Engine, handle: object): WeakRef<object> {
  const ref = new WeakRef(handle);
  let held = heldHandles.get(engine);
  if (!held) {
    held = new Set();
    heldHandles.set(engine, held);
  }
  held.add(ref);
  return ref;
}

export function release(engine: Engine, ref: WeakRef<object>): void {
  heldHandles.get(engine)?.delete(ref);
  disposeAll(ref.deref());
}

function fail(engine: Engine): void {
  failedEngines.add(engine);
  const held = heldHandles.get(engine);
  heldHandles.delete(engine);
  for (const ref of held ?? []) {
    disposeAll(ref.deref());
  }
}

// The key jco binds: `Symbol.dispose`, or `Symbol.for('dispose')` where the runtime lacks it.
const DISPOSE: typeof Symbol.dispose = Symbol.dispose ?? (Symbol.for('dispose') as never);

export function disposeAll(...handles: unknown[]): void {
  for (const handle of handles) {
    try {
      (handle as { [DISPOSE]?: () => void } | undefined)?.[DISPOSE]?.();
    } catch {
      // A drop that traps is the engine failing: the handle is already forgotten, and the next call
      // detects the failure.
    }
  }
}

// Read through globalThis because `WebAssembly`'s types come only with the DOM library.
const RuntimeError = (globalThis as { WebAssembly?: { RuntimeError?: abstract new () => Error } }).WebAssembly
  ?.RuntimeError;

let probeBytes: Uint8Array | undefined;

/** Whether the engine can still parse an object it is known to parse. */
function engineIsHealthy(engine: Engine): boolean {
  probeBytes ??= Uint8Array.from(atob(PROBE_OBJECT_BASE64), (c) => c.charCodeAt(0));
  let config, object;
  try {
    config = new engine.diff.DiffConfig();
    object = engine.diff.Object.parse(probeBytes, config, 'target');
    return true;
  } catch {
    return false;
  } finally {
    disposeAll(object, config);
  }
}

/**
 * Run one engine call. A throw is blamed on the input, as a `Failure` naming `what` with the engine's
 * reason in its message, unless it is a wasm trap after which the engine cannot parse the probe
 * object: then the engine is marked failed.
 */
export function call<T>(
  engine: Engine,
  fn: () => T,
  what: string,
  Failure: new (message: string, options: ErrorOptions) => Error = UndiffableError,
): T {
  if (failedEngines.has(engine)) {
    throw new EngineFailedError();
  }
  try {
    return fn();
  } catch (cause) {
    if (cause instanceof SymbolNotFoundError || cause instanceof UndiffableError) {
      throw cause;
    }
    if (RuntimeError !== undefined && cause instanceof RuntimeError && !engineIsHealthy(engine)) {
      fail(engine);
      throw new EngineFailedError({ cause });
    }
    throw new Failure(`${what}: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
}

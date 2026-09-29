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

/** Hold `handle` among `engine`'s long-lived handles until `owner` is disposed. */
export function hold(engine: Engine, handle: object, owner: DisposableStack): void {
  const ref = new WeakRef(handle);
  let held = heldHandles.get(engine);
  if (!held) {
    held = new Set();
    heldHandles.set(engine, held);
  }
  held.add(ref);
  owner.defer(() => heldHandles.get(engine)?.delete(ref));
}

function fail(engine: Engine): void {
  failedEngines.add(engine);
  const held = heldHandles.get(engine);
  heldHandles.delete(engine);
  for (const ref of held ?? []) {
    drop(ref.deref());
  }
}

/** Release one engine handle: the release every `DisposableStack` here adopts handles with. */
export function drop(handle: unknown): void {
  try {
    (handle as Partial<Disposable> | undefined)?.[Symbol.dispose]?.();
  } catch {
    // A drop that traps is the engine failing: the handle is already forgotten, the next call
    // detects the failure, and a throw here would bury the call's own error in a SuppressedError.
  }
}

// Read through globalThis because `WebAssembly`'s types come only with the DOM library.
const RuntimeError = (globalThis as { WebAssembly?: { RuntimeError?: abstract new () => Error } }).WebAssembly
  ?.RuntimeError;

let probeBytes: Uint8Array | undefined;

/** Whether the engine can still parse an object it is known to parse. */
function engineIsHealthy(engine: Engine): boolean {
  probeBytes ??= Uint8Array.from(atob(PROBE_OBJECT_BASE64), (c) => c.charCodeAt(0));
  using handles = new DisposableStack();
  try {
    const config = handles.adopt(new engine.diff.DiffConfig(), drop);
    handles.adopt(engine.diff.Object.parse(probeBytes, config, 'target'), drop);
    return true;
  } catch {
    return false;
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

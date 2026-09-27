// Every engine call and every engine handle goes through here. A call that traps either blames its
// input or marks the whole engine failed; a handle is released explicitly, and at once for every
// handle of an engine that fails.
import type { Engine } from './engine.js';
import { EngineFailedError, SymbolNotFoundError, UndiffableError } from './errors.js';
import { PROBE_OBJECT_BASE64 } from './probe-object.js';

/** Engines that failed: shared by every scorer made from them, since they share the wasm instance. */
const failedEngines = new WeakSet<Engine>();

/**
 * The handles that outlive one call (each scorer's config, each parsed target), per engine, held
 * weakly. An undisposed handle is dropped by the engine's FinalizationRegistry when collected, and
 * on a failed engine that drop traps outside any caller, as an uncaught exception. So when an
 * engine fails, every handle still held here is released at once.
 */
const heldHandles = new WeakMap<Engine, Set<WeakRef<object>>>();

/** Track a handle that outlives the call that made it, until `release`. */
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

// The engine's handles are component-model resources. Without an explicit dispose they wait on the
// FinalizationRegistry, which a synchronous scoring loop never lets run, until the wasm side
// exhausts and panics and the instance fails every later call in the process.
// The key is the one the engine binds: its jco output falls back to `Symbol.for('dispose')` where
// `Symbol.dispose` is missing, and `Symbol.dispose` alone would silently no-op there.
const DISPOSE: typeof Symbol.dispose = Symbol.dispose ?? (Symbol.for('dispose') as never);

export function disposeAll(...handles: unknown[]): void {
  for (const handle of handles) {
    try {
      (handle as { [DISPOSE]?: () => void } | undefined)?.[DISPOSE]?.();
    } catch {
      // The engine forgets a handle before its drop runs, so a drop that traps leaves nothing
      // behind. The trap is the engine failing, and the next call finds that out.
    }
  }
}

// `WebAssembly` is global in every supported runtime, but no type library here declares it without
// the DOM.
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
 * Run one engine call. A wasm trap is the engine panicking: if the engine still works afterwards the
 * input is to blame and a `Failure` naming `what` is thrown, otherwise the engine is marked failed
 * for good. Any other throw is the input's fault. The engine's reason goes into the message, since
 * most callers print only the message.
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

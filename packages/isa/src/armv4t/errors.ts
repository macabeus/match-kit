/** A broken internal invariant or caller contract (an unknown row id, a broken table): a bug, never a property of the bytes decoded. */
export class IsaInvariantError extends Error {
  override readonly name = 'IsaInvariantError';
}

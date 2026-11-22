/** `build`, run on the first call and remembered: for the lookup tables, which a caller that never uses them should not pay for. */
export function once<T>(build: () => T): () => T {
  let value: { readonly built: T } | undefined;
  return () => {
    value ??= { built: build() };
    return value.built;
  };
}

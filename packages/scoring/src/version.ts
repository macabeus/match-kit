/**
 * The objdiff-wasm version this package is pinned to, for cache keys and reports.
 *
 * Two objdiff releases can align the same object pair differently and disagree on its score (3.7.3
 * and 3.7.0 differed by 4 on one byte-identical pair), so a stored score is only meaningful next to
 * the engine that produced it. `test/version.test.ts` fails when this constant, the dependency in
 * package.json and the installed package disagree.
 */
export const OBJDIFF_VERSION = '3.8.1';

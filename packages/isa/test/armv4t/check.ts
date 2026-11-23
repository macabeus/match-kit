/**
 * An assertion for a loop over a whole encoding space: a plain test, and a message built only on failure. An
 * assertion library's own bookkeeping on each of 130,000 passing checks takes several times longer than the code
 * under test.
 */
export function check(condition: boolean, message: () => string): asserts condition {
  if (!condition) {
    throw new Error(message());
  }
}

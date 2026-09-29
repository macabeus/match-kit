# @matchkit/scoring

Score a compiled candidate against a target object, one symbol at a time, with the
[objdiff](https://github.com/encounter/objdiff) engine (`objdiff-wasm`, pinned to an exact version).
Runs on Node ≥ 24, Bun and browsers with `DisposableStack` (Chrome ≥ 134, Firefox ≥ 141).

```sh
npm install @matchkit/scoring
```

## Score two objects

```ts
import { createScorer } from '@matchkit/scoring';

using scorer = await createScorer(); // loads the engine once per process or worker
using target = scorer.parseTarget(targetBytes); // parse once, score many candidates against it

const score = scorer.score(target, candidateBytes, 'MyFunction');
// { symbol, score: 3, match: false, rows: 14, matching: 11,
//   breakdown: { insert: 1, delete: 0, replace: 0, opMismatch: 0, argMismatch: 2 } }
```

- `score` is the number of differing instruction rows; `0` is a byte-exact match.
- `rows` is the scale the score is measured on. It belongs to the candidate's alignment, so two
  candidates of one function can have different `rows`.
- The breakdown sums to `score`.

## Score files on Node

```ts
import { releaseTarget, scoreFiles } from '@matchkit/scoring/files';

scoreFiles('build/target.o', 'tmp/candidate.o', 'MyFunction');
```

`scoreFiles` is synchronous and keeps two memos, both keyed on file content:

- the parsed target, compared byte for byte, so a target rewritten in place is parsed again;
- each candidate's score, keyed by the candidate's SHA-256 and the symbol.

`releaseTarget()` drops both.

## Show the rows

```ts
import { assembly, differences, sideBySide } from '@matchkit/scoring/display';

const inspection = scorer.inspect(target, candidateBytes, 'MyFunction');
console.log(sideBySide(inspection));
differences(inspection); // [{ row, kind: 'argMismatch', target: 'add r0, #0x1', candidate: 'add r0, #0x2' }, …]
```

## How a score is counted

- **Sides.** The target is objdiff's left side and the candidate its right, as in objdiff's own UI.
- **Row kind.** A row's kind is the target side's kind, else the candidate side's. A row counts as
  a difference when either side differs.
- **Fails closed.** Every failure throws:
  - `SymbolNotFoundError` (with `side`) when the symbol is missing from either object.
  - `UndiffableError` when this pair cannot be diffed: an object that cannot be parsed, a row that
    cannot be displayed, a symbol with zero rows, or a row that does not decode as an instruction
    and would count as matching (objdiff diffs any two undecoded rows as matching; a wrong
    `arm.archVersion` makes every row one). An undecoded row that differs anyway is counted. The
    next pair may still score.
  - `EngineFailedError` when the engine itself has failed. Each panic leaks engine memory, and
    after a few thousand the engine fails every call. From then on every call in the process throws
    this: restart the process.
- **Config.** The `DiffConfig` is objdiff's default unless `createScorer({ diffSettings })`
  sets properties, and `scorer.configKey` spells them. Put `configKey` into any cache key next to
  `OBJDIFF_VERSION`: both change what a score means. An invalid setting rejects `createScorer`.
- **Engine handles.** Every handle a call creates is released before it returns. The parsed target
  and the scorer's `DiffConfig` live until their `using` block ends, or until `dispose()`.

## Bundlers

objdiff-wasm initializes with a top-level `await` and fetches its `.wasm` next to its own module.
With Vite, exclude it from dependency pre-bundling, or the dev server serves the wasm with the wrong
MIME type:

```js
// vite.config.js
export default { optimizeDeps: { exclude: ['objdiff-wasm'] }, build: { target: 'es2022' } };
```

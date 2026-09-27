# @matchkit/scoring

Score a compiled candidate against a target object, one symbol at a time, with the
[objdiff](https://github.com/encounter/objdiff) engine (`objdiff-wasm`, pinned to an exact version).
Runs on Node ≥ 20, Bun and browsers.

```sh
npm install @matchkit/scoring
```

## Score two objects

```ts
import { createScorer, loadEngine } from '@matchkit/scoring';

const scorer = createScorer(await loadEngine());
const target = scorer.parseTarget(targetBytes); // parse once, score many candidates against it

const score = scorer.score(target, candidateBytes, 'MyFunction');
// { symbol, score: 3, match: false, rows: 14, matching: 11,
//   breakdown: { insert: 1, delete: 0, replace: 0, opMismatch: 0, argMismatch: 2 } }

target.dispose();
scorer.dispose();
```

- `score` is the number of differing instruction rows; `0` is a byte-exact match.
- `rows` is the scale the score is measured on. It belongs to the candidate's alignment, so two
  candidates of one function can have different `rows`.
- The breakdown sums to `score`.

## Score files on Node

```ts
import { releaseTarget, scoreFiles } from '@matchkit/scoring/node';

scoreFiles('build/target.o', 'tmp/candidate.o', 'MyFunction');
```

`scoreFiles` is synchronous and keeps two memos, both keyed on file content, never on a path:

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

- **Sides.** The target is objdiff's left side and the candidate its right side, as objdiff's own UI
  lays them out.
- **Row kind.** A row's kind is the target side's kind, else the candidate side's. A row counts as
  a difference when either side differs.
- **Fails closed.** A failure is never a score:
  - `SymbolNotFoundError` (with `side`) when the symbol is missing from either object.
  - `UndiffableError` when this pair cannot be diffed. That covers an object that cannot be parsed,
    a row that cannot be displayed, a symbol with zero rows, and a row that does not decode as an
    instruction and would count as matching (objdiff diffs any two undecoded rows as matching; a
    wrong `arm.archVersion` makes every row one). An undecoded row that differs anyway is counted.
    The next pair may still score.
  - `EngineFailedError` when the engine itself has failed. Every object the engine panics on costs
    it memory it never recovers, and after a few thousand panics it fails every call. From then on
    every call in the process throws this: stop, and restart the process.
- **Config.** The engine's `DiffConfig` is objdiff's default. `createScorer(engine, { diffSettings })`
  changes it, and `scorer.configKey` then spells the settings. Put `configKey` into any cache key next
  to `OBJDIFF_VERSION`, because both change what a score means. An invalid setting throws when the
  scorer is created.
- **Engine version.** `createScorer` refuses an engine whose `version()` is not `OBJDIFF_VERSION`, so
  a cache key cannot name one version while another scores.
- **Engine handles.** Every handle a call creates is released before it returns. The parsed target
  lives until its `dispose()`, and the scorer's `DiffConfig` until `scorer.dispose()`.

## Bundlers

objdiff-wasm initializes with a top-level `await` and fetches its `.wasm` next to its own module.
With Vite, exclude it from dependency pre-bundling, or the dev server serves the wasm with the wrong
MIME type:

```js
// vite.config.js
export default { optimizeDeps: { exclude: ['objdiff-wasm'] }, build: { target: 'es2022' } };
```

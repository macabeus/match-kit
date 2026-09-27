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
differences(inspection); // [{ row, kind: 'argMismatch', target: 'add r0, 0x1', candidate: 'add r0, 0x2' }, …]
```

## How a score is counted

- **Sides.** The target is objdiff's left side and the candidate its right side, as objdiff's own UI
  lays them out.
- **Row kind.** A row's kind is the target side's kind, else the candidate side's. A row counts as
  a difference when either side differs.
- **Fails closed.** Each failure throws, and a failure is never a score:
  - `SymbolNotFoundError` (with `side`) when the symbol is missing from either object;
  - `UndiffableError` when an object cannot be parsed, when a row cannot be displayed, or when the
    symbol has zero rows.
- **Config.** The engine's `DiffConfig` is objdiff's default. `createScorer(engine, { diffSettings })`
  changes it, and `scorer.configKey` then spells the settings. Put `configKey` into any cache key
  next to `OBJDIFF_VERSION`, because both change what a score means.
- **Engine handles.** Every handle is released after each call. Only the parsed target lives until
  its `dispose()`.

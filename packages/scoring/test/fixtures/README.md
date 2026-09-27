# Fixtures

## `golden/`: 28 target/candidate pairs with the score asmlift published for each

Seven pairs per compiler: agbcc (GBA), IDO 7.1 and KMC GCC (N64), CodeWarrior 2.4.2 build 81
(GameCube). Together they cover an exact match and every breakdown kind.

Each pair is one row of asmlift's synthetic benchmark tier, at the asmlift commit named in
`manifest.json`:

- **target:** the row's reference C, compiled by the benchmark's own target build.
- **candidate:** asmlift's or m2c's published output for that row, compiled through the benchmark's
  own candidate compiler. m2c's output is also retried with the benchmark's dialect typedefs.
- **expected:** the score asmlift's scorer gave the pair at that commit.

A pair was kept only if its score equals the score the benchmark published for that row, and all
28 did. `manifest.json` records the row, the decompiler, the published score and the expected
`MatchScore` for each pair.

To add pairs, rebuild them the same way from an asmlift checkout: `cachedBuildTarget` for the
target, `benchCompilerFor(toolchain, row.cflags)` for the candidate, and asmlift's `scoreObjects`
for the expected score. Keep only pairs whose score equals the published one.

## `edge/`: objects for the cases a scorer must refuse or handle specially

| File                                            | What it is                                                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `target.o`, `candidate-diff.o`                  | agbcc, `int add_one(int x) { return x + 1; }` against `x + 2`; from asmlift's scorer tests                                      |
| `candidate-odd-size.o`                          | `candidate-diff.o` with `add_one`'s `st_size` cut to 3, so its last row is half an instruction and the engine cannot display it |
| `zero-rows.o`                                   | `empty_fn` with size 0, beside a real `add_one`; assembled with `arm-none-eabi-as`                                              |
| `cpp-method.target.o`, `cpp-method.candidate.o` | CodeWarrior 2.4.2 C++, `Counter::inc()` (`inc__7CounterFv`), `n += 1` against `n += 2`                                          |

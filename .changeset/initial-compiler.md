---
'@match-kit/compiler': minor
---

First release: run a project's compile command template on Node and Bun. `createRunner` checks the template (`{{inputPath}}`, `{{outputPath}}`, and the optional `{{symbol}}` and `{{flags}}`, which the runner's `flags` fill as quoted shell words), and `compile` runs each candidate in a fresh directory, which disposing its outcome removes. An outcome tells the compiler's own answers (`ok`, `rejected`, `no-object`), which `isStable` marks safe to cache, from interrupted compiles (`killed`, `aborted`, `spawn-failed`). Commands run under `sh -ec` with their output in files, and a runner's `AbortSignal` ends a compile's whole process group.

# @match-kit/compiler

Run a project's compile command template, such as the `compiler` of a decomp.yaml tool block: one
candidate source in, one object out, and every way a compile can fail told apart. Node and Bun.

```sh
npm install @match-kit/compiler
```

## Compile a candidate

```ts
import { createRunner, isStable } from '@match-kit/compiler';

await using runner = createRunner('tools/agbcc -O2 {{inputPath}} -o {{outputPath}}', { cwd: projectDir });
const scratch = runner.scratch(); // one per worker

const outcome = await scratch.compile(source, { ext: 'c', symbol: 'UpdatePlayer' });
if (outcome.kind === 'ok') {
  score(outcome.object); // lives until this scratch's next compile
}
```

## The template

| Placeholder        | Becomes                                  |
| ------------------ | ---------------------------------------- |
| `{{inputPath}}`    | the candidate source file (required)     |
| `{{outputPath}}`   | the object the command writes (required) |
| `{{symbol}}`       | the `symbol` compile option              |
| `{{functionName}}` | the same value as `{{symbol}}`           |

`createRunner` throws a `TemplateError` for a template without both paths or with any other
`{{placeholder}}`. Values reach the shell as written, so the template owns the quoting, and a value
the shell would read as more than one word throws.

The command runs under `sh -ec`: a step that fails fails the compile, even when a later step succeeds.

## Outcomes

| `kind`         | Meaning                                                        | `isStable` |
| -------------- | -------------------------------------------------------------- | ---------- |
| `ok`           | exit 0 and an object at `object`                               | yes        |
| `rejected`     | exit 1 to 127: the compiler refused the candidate              | yes        |
| `no-object`    | exit 0 and no object                                           | yes        |
| `killed`       | a signal ended the compile (exit 128 or more, or no exit code) | no         |
| `aborted`      | the runner's `signal` aborted the compile                      | no         |
| `spawn-failed` | the shell did not start                                        | no         |

A stable outcome is the compiler's own answer and is safe to cache; the others can differ on the next
run. A failed outcome carries the `command` and the compiler's `output` (stderr, or stdout when stderr
is empty), with the scratch directory written as `<scratch>`, so a failure reads the same on every run.

## Options

- `cwd`: the directory the command runs in, such as the decomp.yaml's directory.
- `signal`: an `AbortSignal` for the async compiles. Each one then runs in its own process group, and
  an abort ends the whole group, the compiler under the shell included. Without a signal, compiles stay
  in the caller's process group, so a terminal's Ctrl-C reaches them.
- `maxOutputBytes`: the most bytes of stdout, and of stderr, an outcome keeps. Default: all of it.

## Scratches

A scratch runs one compile at a time, and each compile gets a fresh directory, which removes the
previous one. Give each worker, or each compile in flight, its own scratch. Disposing a scratch removes
its directory; disposing the runner waits for the compiles in flight and then removes every scratch.

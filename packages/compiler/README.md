# @match-kit/compiler

Run a project's compile command template, such as the `compiler` of a decomp.yaml tool block: one
candidate source in, one object out, and every way a compile can fail told apart. Node and Bun.

```sh
npm install @match-kit/compiler
```

## Compile a candidate

```ts
import { createRunner, isStable } from '@match-kit/compiler';

await using runner = createRunner('tools/agbcc {{flags}} {{inputPath}} -o {{outputPath}}', {
  cwd: projectDir,
  flags: ['-O2', '-mthumb-interwork'],
});

using outcome = await runner.compile(source, { ext: 'c', symbol: 'UpdatePlayer' });
if (outcome.kind === 'ok') {
  score(outcome.object); // removed when `outcome` is disposed
}
```

Each compile runs in a fresh directory, so any number can run at once. Disposing an outcome removes
its directory, and with it the object; a failed compile's directory is removed before it returns.
Disposing the runner waits for the compiles in flight, then removes every directory still kept.

## The template

| Placeholder      | Becomes                                                            |
| ---------------- | ------------------------------------------------------------------ |
| `{{inputPath}}`  | the candidate source file (required)                               |
| `{{outputPath}}` | the object the command writes (required)                           |
| `{{symbol}}`     | the `symbol` compile option                                        |
| `{{flags}}`      | the runner's `flags`, each one shell word, quoted where it must be |

`createRunner` throws a `TemplateError` for a template without both paths, with any other
`{{placeholder}}`, or with `{{flags}}` and `flags` that disagree. Paths and the symbol reach the shell
as written, so the template owns their quoting, and a symbol the shell would read as more than one
word throws.

The command runs under `sh -ec`: a step that fails fails the compile, even when a later step succeeds.

## Outcomes

| `kind`         | Meaning                                                                             | `isStable` |
| -------------- | ----------------------------------------------------------------------------------- | ---------- |
| `ok`           | exit 0 and an object at `object`                                                    | yes        |
| `rejected`     | the compiler exited with `exitCode`: it refused the candidate                       | yes        |
| `no-object`    | exit 0 and no object                                                                | yes        |
| `crashed`      | a program crashed with `signal` (SIGSEGV, SIGBUS, SIGILL, SIGFPE, SIGABRT)          | no         |
| `killed`       | `signal` ended the compile from outside (SIGHUP, SIGINT, SIGQUIT, SIGKILL, SIGTERM) | no         |
| `not-run`      | a program did not run: exit 126 or 127 from the shell, 125 from `docker run`        | no         |
| `aborted`      | the runner's `signal` aborted the compile                                           | no         |
| `spawn-failed` | the shell did not start                                                             | no         |

The shell reports a child that signal n ended as exit 128 + n, which a program can also exit with on
purpose, so only those ten signals are read off an exit status; any other status, such as 255 from
`exit(-1)`, is the program's own and reads as `rejected`.

A stable outcome is the compiler's own answer and is safe to cache; the others can differ on the next
run. A failed outcome carries the `command` and the compiler's `output` (stderr, or stdout when stderr
is empty), with the compile's directory written as `<scratch>`, so a failure reads the same on every
run.

## Options

- `cwd`: the directory the command runs in, such as the decomp.yaml's directory.
- `flags`: the compiler's flags, for `{{flags}}`.
- `signal`: an `AbortSignal` for the compiles. Each one then runs in its own process group, and an
  abort ends the whole group, the compiler under the shell included. Without a signal, compiles stay
  in the caller's process group, so a terminal's Ctrl-C reaches them.
- `maxOutputBytes`: the most bytes of stdout, and of stderr, an outcome keeps. Default: all of it.

# matchkit

Shared building blocks for matching-decompilation tools: the parts
[asmlift](https://github.com/macabeus/asmlift) and [Transmuter](https://github.com/macabeus/transmuter)
both need, implemented once so the two tools never score the same pair of objects differently.

| Package                                 | What it does                                                               |
| --------------------------------------- | -------------------------------------------------------------------------- |
| [`@matchkit/scoring`](packages/scoring) | Score a compiled candidate against a target object with the objdiff engine |

Planned next: `@matchkit/decomp-yaml` (read a project's `decomp.yaml`) and `@matchkit/compiler` (run a
project's compile command template).

## Rules every package follows

- **Runs on Node ≥ 22, Bun and browsers.** No `Bun.*` API. A module that needs Node is a separate,
  Node-only entry point, and `pnpm check-deps` fails if a browser-safe module reaches one.
- **Fails closed.** An error throws; it never becomes a plausible-looking result.
- **Tested without compilers.** Tests read committed fixtures, so CI needs nothing but `node_modules`.

## Development

```sh
pnpm install
pnpm test            # Node
pnpm test:bun        # the same tests under Bun
pnpm test:browser    # browser tests in headless Chromium (first run: pnpm exec playwright install chromium)
pnpm typecheck && pnpm lint && pnpm format:check && pnpm check-deps
pnpm check-package   # the packed tarball, installed into a throwaway consumer (Node, Bun, tsc, Vite)
```

[CONTRIBUTING.md](CONTRIBUTING.md) covers trying an unpublished change inside asmlift or Transmuter,
and releasing.

## License

MIT

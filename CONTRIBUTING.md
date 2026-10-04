# Contributing

## Layout

```
packages/<name>/
  src/            the package's source; `dist/` is built from it and is the only thing published.
                  The top of `src/` holds the entry points (see `exports` in `package.json`) and
                  `types.ts`; the folders hold the internals
  test/           vitest suites; `*.browser.test.ts` run in Chromium, everything else on Node and Bun
  tsconfig.build.json
```

Tests run against `src/`, so nothing needs building before `pnpm test`. A per-runtime import (such
as `#engine` in `@match-kit/scoring`) resolves to source through the `match-kit-source` condition in
`tsconfig.base.json` and the aliases in `vitest.config.ts`.

## Trying a change inside asmlift or Transmuter

Both tools install the packages from npm. To run one against a working copy, clone match-kit next
to the tool and link it:

```sh
# in match-kit
pnpm install
pnpm --filter @match-kit/scoring dev    # rebuilds dist/ on every change

# in the tool, from the package that depends on @match-kit/scoring
pnpm link ../../../match-kit/packages/scoring    # from asmlift/packages/cli: the path to match-kit's package
```

`pnpm link` symlinks the package into that package's `node_modules` until the next `pnpm install`.
To keep the link across installs, declare it in `package.json` as
`"@match-kit/scoring": "link:../../../match-kit/packages/scoring"` (the same relative path). Never
merge a `link:` dependency: set it to the published exact version and run `pnpm install` first.

## Releasing

Each package is versioned on its own with [changesets](https://github.com/changesets/changesets).

1. Every PR that changes a published package adds a changeset: `pnpm changeset`.
2. To release, on an up-to-date `main`: `pnpm release:version`, review the version bumps and
   changelogs, commit, and push. It runs `changeset version`, then points `@match-kit/decomp-yaml`'s
   schema URLs at its new version.
3. `pnpm build && pnpm changeset publish --otp <code>`, then `git push --tags`.

Publishing needs the npm account's two-factor code, so a maintainer runs step 3.

A change to `@match-kit/scoring` that can move any score (an objdiff-wasm update, a change to how
rows are classified) is at least a minor release, and its changeset says that scores move.

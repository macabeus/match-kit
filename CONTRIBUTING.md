# Contributing

## Layout

```
packages/<name>/
  src/            the package's source; `dist/` is built from it and is the only thing published
  test/           vitest suites; `*.browser.test.ts` run in Chromium, everything else on Node and Bun
  tsconfig.build.json
```

Tests run against `src/` directly, so there is nothing to build before `pnpm test`. A package's
per-runtime import (for example `#engine` in `@matchkit/scoring`) resolves to its source through
the `matchkit-source` condition in `tsconfig.base.json` and the aliases in `vitest.config.ts`.

## Trying a change inside asmlift or Transmuter

Both tools consume the packages from npm. To run one against your working copy instead, clone
matchkit next to the tool and link it:

```sh
# in matchkit
pnpm install
pnpm --filter @matchkit/scoring dev    # rebuilds dist/ on every change

# in the tool, from the package that depends on @matchkit/scoring
pnpm link ../../../matchkit/packages/scoring    # from asmlift/packages/cli: the path to matchkit's package
```

`pnpm link` only symlinks the package into that package's `node_modules`, and the next
`pnpm install` undoes it. A branch that needs an unpublished change for longer declares it in
`package.json` instead, as `"@matchkit/scoring": "link:../../../matchkit/packages/scoring"` (the
same relative path), so installs and the lockfile keep it. A tool never merges a `link:`
dependency: before merging, set it to the published version (an exact version, never a range) and
run `pnpm install`.

## Releasing

Versions are managed with [changesets](https://github.com/changesets/changesets), and each package
is versioned on its own.

1. Every PR that changes a published package adds a changeset: `pnpm changeset`.
2. To release, on an up-to-date `main`: `pnpm changeset version`, review the version bumps and
   changelogs, commit, and push.
3. `pnpm build && pnpm changeset publish --otp <code>`, then `git push --tags`.

Publishing needs the npm account's two-factor code, so step 3 is always run by a maintainer.

A change to `@matchkit/scoring` that can move any score (an objdiff-wasm update, a change to how
rows are classified) is at least a minor release, and its changeset says that scores move.

# @match-kit/decomp-yaml

Read a project's `decomp.yaml`, the [decomp_settings](https://github.com/ethteck/decomp_settings)
format that matching-decompilation tools share, checked against its spec. Read your tool's block with
your own [Standard Schema](https://standardschema.dev) (zod, valibot, ArkType, …). Runs on Node ≥ 24,
Bun and browsers.

```sh
npm install @match-kit/decomp-yaml
```

## Read a project's decomp.yaml

```ts
import { toolBlock } from '@match-kit/decomp-yaml';
import { loadDecompYaml } from '@match-kit/decomp-yaml/files';
import * as z from 'zod';

const loaded = loadDecompYaml(); // { path, dir, config }, or null when there is none
loaded?.config.platform; // 'gba'

const MyTool = z.strictObject({ compiler: z.string().optional(), jobs: z.number().int().optional() });
const settings = toolBlock(loaded, 'mytool', MyTool); // { compiler?, jobs? }, or undefined
```

- `loadDecompYaml(explicitPath?, startDir?)` reads `explicitPath`, or else the nearest file from
  `startDir` (default: the working directory) up to the root, trying `decomp.yaml` before
  `decomp.yml` in each directory. A missing explicit path throws.
- `findDecompYaml(startDir?)` returns that nearest path without reading it.
- `dir` is the file's directory. The config's relative paths are relative to it.
- `@match-kit/decomp-yaml/files` needs Node or Bun. In a browser, parse the text you have:
  `parseDecompYaml(text, path?)`.

## Your tool's block

`toolBlock(loaded, tool, schema)` validates `tools.<tool>` with `schema` and returns the schema's
output, so defaults and transforms apply. It returns `undefined` when there is no config or no block
for the tool.

The schema decides what the block may hold: `z.strictObject` refuses unknown keys, such as a typo,
and `z.object` drops them. The schema must validate synchronously.

## The format

[SPEC.md](SPEC.md) specifies decomp.yaml as decomp_settings 0.0.10 declares it, and
[`schema.json`](schema.json) is the same specification as a JSON Schema, also exported as
`@match-kit/decomp-yaml/schema.json`. To check a file in your editor, start it with:

```yaml
# yaml-language-server: $schema=https://cdn.jsdelivr.net/npm/@match-kit/decomp-yaml@0.0.0/schema.json
```

## What is checked

A decomp.yaml must meet the spec: its required fields, only the keys it names (any key inside
`tools`), and every field of its type. A field left empty (`null`) reads as missing. The one difference from the
official decomp_settings reader: that reader also takes a number or boolean where a string is expected,
and this package refuses it.

Every failure throws `DecompYamlError`, one line per problem, each prefixed with the file's path:

```
/home/me/game/decomp.yaml: versions[0].paths.map: Invalid input: expected string, received undefined
/home/me/game/decomp.yaml: Unrecognized key: "github"
/home/me/game/decomp.yaml: tools.mytool.jobs: Invalid input: expected number, received string
```

`error.path` is the file and `error.problems` the lines without it.

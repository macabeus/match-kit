# @match-kit/decomp-yaml

Read a project's `decomp.yaml`, the [decomp_settings](https://github.com/ethteck/decomp_settings)
format that matching-decompilation tools share, and check your tool's block with your own
[Standard Schema](https://standardschema.dev) (zod, valibot, ArkType, …). Runs on Node ≥ 24, Bun and
browsers.

```sh
npm install @match-kit/decomp-yaml
```

## Read a project's decomp.yaml

```ts
import { toolBlock } from '@match-kit/decomp-yaml';
import { loadDecompYaml } from '@match-kit/decomp-yaml/files';
import { z } from 'zod';

const loaded = loadDecompYaml(); // { path, dir, config }, or null when there is none
loaded?.config.platform; // 'gba'

const MyTool = z.strictObject({ compiler: z.string().optional(), jobs: z.number().int().optional() });
const settings = toolBlock(loaded, 'mytool', MyTool); // { compiler?, jobs? }, or undefined
```

- `loadDecompYaml(explicitPath?, startDir?)` reads `explicitPath`, or else the nearest file from
  `startDir` (default: the working directory) up to the root, trying `decomp.yaml` before
  `decomp.yml` in each directory. An explicit path that does not exist throws.
- `findDecompYaml(startDir?)` returns that nearest path without reading it.
- `dir` is the file's directory. The config's relative paths are relative to it.
- `@match-kit/decomp-yaml/files` needs Node or Bun. In a browser, parse the text you have:
  `parseDecompYaml(text, path?)`.

## Your tool's block

`toolBlock(loaded, tool, schema)` validates `tools.<tool>` with `schema` and returns the schema's
output, so defaults and transforms apply. It returns `undefined` when there is no config or no block
for the tool.

The schema decides what the block may hold: `z.strictObject` refuses a key it does not name, such as
a typo, and `z.object` drops it. The schema must validate synchronously.

## What is checked

- **Accepted:** every field may be missing, and keys the decomp_settings spec does not name are kept.
  The official decomp_settings reader (0.0.10) is stricter: it requires `name`, `platform`, `versions`,
  and per version `fullname` plus four paths (`target`, `build_dir`, `map`, `compiled_target`), and
  refuses unknown keys. Files written for decomp_settings 0.0.8 (`github`, `baserom`, `build`) and files
  holding only a tool's block fail it, and this package reads them.
- **Refused:** a file that is not YAML, a top level that is not a mapping, and a field the spec names
  with the wrong type (`platform: 64`, `versions: us`).

Every failure throws `DecompYamlError`, one line per problem, each prefixed with the file's path:

```
/home/me/game/decomp.yaml: versions[0].paths.elf must be a string, not a list
/home/me/game/decomp.yaml: tools.mytool.jobs: Invalid input: expected number, received string
```

`error.path` is the file and `error.problems` the lines without it.

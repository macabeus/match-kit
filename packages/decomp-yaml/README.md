# @match-kit/decomp-yaml

Read a project's `decomp.yaml`, the [decomp_settings](https://github.com/ethteck/decomp_settings)
format that matching-decompilation tools share, checked against its spec. Read your tool's block with
your own [Standard Schema](https://standardschema.dev) (zod, valibot, ArkType, …).

```sh
npm install @match-kit/decomp-yaml
```

## Read a project's decomp.yaml

```ts
import { toolBlock } from '@match-kit/decomp-yaml';
import { loadDecompYaml, searchDecompYaml } from '@match-kit/decomp-yaml/files';
import * as z from 'zod';

const loaded = searchDecompYaml(); // { path, dir, config }, or null when there is none
loaded?.config.platform; // 'gba'

const MyTool = z.strictObject({ compiler: z.string().optional(), jobs: z.number().int().optional() });
const settings = toolBlock(loaded, 'mytool', MyTool); // { compiler?, jobs? }, or undefined
```

- `searchDecompYaml(from?)` reads the nearest decomp.yaml from `from` (default: the working directory)
  up to the root, trying `decomp.yaml` before `decomp.yml` in each directory, or returns `null`.
- `loadDecompYaml(path)` reads the file at `path`, and a missing one throws.
- `@match-kit/decomp-yaml/files` needs Node or Bun. In a browser, use `parseDecompYaml(text, path?)`.

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
# yaml-language-server: $schema=https://cdn.jsdelivr.net/npm/@match-kit/decomp-yaml/schema.json
```

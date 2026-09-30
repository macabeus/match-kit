---
'@match-kit/decomp-yaml': minor
---

First release: read a project's `decomp.yaml` (the decomp_settings format). `loadDecompYaml` and `findDecompYaml` find the nearest `decomp.yaml` or `decomp.yml` on Node and Bun (`@match-kit/decomp-yaml/files`); `parseDecompYaml` reads the text anywhere, refusing a field of the wrong type but not a missing one; `toolBlock` reads a tool's block through that tool's own Standard Schema.

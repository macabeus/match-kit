---
'@match-kit/decomp-yaml': minor
---

First release: read a project's `decomp.yaml` (the decomp_settings format). `loadDecompYaml` and `findDecompYaml` find the nearest `decomp.yaml` or `decomp.yml` on Node and Bun (`@match-kit/decomp-yaml/files`); `parseDecompYaml` reads the text anywhere, refusing a field of the wrong type but not a missing or empty one; `toolBlock` reads a tool's block through that tool's own Standard Schema. `SPEC.md` specifies the format as decomp_settings 0.0.10 declares it, and `@match-kit/decomp-yaml/schema.json` is the same specification as a JSON Schema.

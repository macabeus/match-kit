# decomp.yaml

A matching-decompilation project keeps the settings its tools share in one file, `decomp.yaml`, at the
root of the project. The format is [decomp_settings](https://github.com/ethteck/decomp_settings). This
document describes it as its official reader, decomp_settings 0.0.10 (Rust and Python), declares it.

[`schema.json`](schema.json) is the same specification as a JSON Schema (draft 2020-12). To check a
file and get completion in an editor that uses the YAML language server (VS Code with the YAML
extension, JetBrains IDEs, Neovim, Zed), start the file with:

```yaml
# yaml-language-server: $schema=https://cdn.jsdelivr.net/npm/@match-kit/decomp-yaml@0.0.0/schema.json
```

## Example

```yaml
name: Example 64
repo: https://github.com/example/example64
platform: n64
build_system: make
versions:
  - name: us
    fullname: US
    paths:
      target: baserom.us.z64
      build_dir: build/us
      map: build/us/example64.map
      compiled_target: build/us/example64.z64
      elf: build/us/example64.elf
      asm: asm/us
      nonmatchings: asm/us/nonmatchings
tools:
  mytool:
    any: settings mytool defines
```

## Fields

Paths are relative to the directory that holds the decomp.yaml. An optional field may be left out or
left empty (`null`). Only the keys in these tables are allowed, plus any key inside `tools`.

<!-- fields: generated from schema.json by test/schema.test.ts -->

| Field          | Type             | Required | Description                                                                          | Example                               |
| -------------- | ---------------- | -------- | ------------------------------------------------------------------------------------ | ------------------------------------- |
| `name`         | string           | yes      | The project's human-readable name.                                                   | `Paper Mario`                         |
| `repo`         | string           |          | The project's repository URL.                                                        | `https://github.com/pmret/papermario` |
| `website`      | string           |          | The project's website.                                                               |                                       |
| `discord`      | string           |          | An invite link to the project's Discord server.                                      |                                       |
| `platform`     | string           | yes      | The platform the project's game or program runs on.                                  | `n64`                                 |
| `build_system` | string           |          | The build system the project uses.                                                   | `make`                                |
| `versions`     | list of versions | yes      | Every version of the target the project decompiles, such as each region or revision. |                                       |
| `tools`        | mapping          |          | Settings for each tool, keyed by the tool's name. Each tool defines its own block.   |                                       |

| Field                 | Type    | Required | Description                                                                                     | Example  |
| --------------------- | ------- | -------- | ----------------------------------------------------------------------------------------------- | -------- |
| `versions[].name`     | string  | yes      | A short identifier for the version, easy to type.                                               | `us10`   |
| `versions[].fullname` | string  | yes      | The version's human-readable name.                                                              | `US 1.0` |
| `versions[].sha1`     | string  |          | The SHA-1 of the target binary, so tools can check they work on the right one.                  |          |
| `versions[].paths`    | mapping | yes      | The files and directories tools need for this version, relative to the decomp.yaml's directory. |          |

| Field                                         | Type   | Required | Description                                                                                     | Example                                  |
| --------------------------------------------- | ------ | -------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `versions[].paths.target`                     | string | yes      | The original binary the project matches, often called the baserom.                              | `config/us/baserom_decompressed.us.z64`  |
| `versions[].paths.build_dir`                  | string | yes      | The directory the build writes its artifacts to.                                                | `build/us/`                              |
| `versions[].paths.map`                        | string | yes      | The map file the build writes.                                                                  | `build/us/drmario64.us.map`              |
| `versions[].paths.compiled_target`            | string | yes      | The binary the project's build produces.                                                        | `build/us/drmario64_uncompressed.us.z64` |
| `versions[].paths.elf`                        | string |          | The intermediate ELF the build produces, if any.                                                | `build/pokemonsnap.elf`                  |
| `versions[].paths.expected_dir`               | string |          | The directory of expected build output to compare against, often a copy of the build directory. | `expected/`                              |
| `versions[].paths.asm`                        | string |          | The directory of disassembled assembly.                                                         | `asm/`                                   |
| `versions[].paths.nonmatchings`               | string |          | The directory of the functions and files still to match.                                        | `asm/nonmatchings`                       |
| `versions[].paths.compressed_target`          | string |          | The original binary before decompression, if the target is compressed.                          | `config/usa/rom_original.z64`            |
| `versions[].paths.compressed_compiled_target` | string |          | The compressed binary the build produces, if any.                                               | `build/usa/compressed_rom.z64`           |

<!-- fields: end -->

## Tool settings

`tools` maps a tool's name to that tool's settings. The format leaves each block to its tool: the
tool documents its keys and checks them.

## What the official reader also accepts

The schema follows the types decomp_settings declares. Its reader is more permissive in two places,
and @match-kit/decomp-yaml refuses both:

- A number or boolean where a string is expected (`name: 123`) is read as its text.
- `versions:` left empty is read as no versions.

## How @match-kit/decomp-yaml reads it

[@match-kit/decomp-yaml](README.md) accepts exactly the files this specification accepts. Its loader
also finds `decomp.yml`, trying it after `decomp.yaml`.

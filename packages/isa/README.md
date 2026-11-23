# @match-kit/isa

Instruction sets for decompilation tools: decode bytes, print them as assembly that assembles back
to the same bytes, parse that text and encode it. Node, Bun and browsers; no dependencies.

```sh
npm install @match-kit/isa
```

| Entry point             | Architecture                              |
| ----------------------- | ----------------------------------------- |
| `@match-kit/isa/armv4t` | ARMv4T: ARM and Thumb, as on the ARM7TDMI |

Each architecture is its own entry point, and there is no root entry.

## ARMv4T

```ts
import { type SymbolResolver, assemble, decode, format, formatRaw, parse } from '@match-kit/isa/armv4t';

const names: SymbolResolver = {
  labelFor: (addr) => `_${addr.toString(16).toUpperCase().padStart(8, '0')}`,
  addressOf: (name) => (/^_[0-9A-F]{8}$/.test(name) ? Number.parseInt(name.slice(1), 16) : undefined),
};

const insn = decode('thumb', 0x4800, 0x0800_0000);
insn.flow; // { kind: 'pool-load', pool: 0x08000004, rd: 0 }
format(insn, names); // 'ldr r0, _08000004'
formatRaw(insn); // '.inst.n 0x4800 @ ldr r0, 0x08000004'

const parsed = parse('adds r0, r0, #1', 'thumb', 0x0800_0000, names);
if (parsed !== undefined) assemble(parsed, 0x0800_0000); // { specId: 'thumb.add_imm8', size: 2, word: 0x3001 }
```

| Function                                   | What it does                                                                                                |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `decode(mode, word, addr)`                 | The instruction of a word. Never throws: a word no instruction owns decodes to an undefined row             |
| `thumbWordAt(read16, addr)`                | The word `decode` takes for Thumb: a halfword with the next one above it, so a `bl` pair is one instruction |
| `operandsOf(insn)`                         | What the text says, as numbers: `{ rd: 0, rn: 1, imm: 4 }` for Thumb `ldr r0, [r1, #4]`                     |
| `format(insn, resolver)`                   | GNU as unified syntax, or `undefined` when the instruction has no text `as` assembles back (see below)      |
| `formatRaw(insn)`                          | The bytes as `.inst`, with the decoding in a comment. Always prints                                         |
| `formatLoose(insn, resolver)`              | What the instruction is, for a debugger's listing, whether or not `as` gives its bytes back                 |
| `parse(text, mode, addr, resolver)`        | Reads the text `format` writes: every table row that accepts it, or `undefined`                             |
| `assemble(parsed, addr)`                   | The encoding GNU as picks, or `undefined` for text it rejects                                               |
| `assembleText(text, mode, addr, resolver)` | `parse` and `assemble` in one call, with the reason when the text has no encoding                           |
| `rawReason(insn, resolver)`, `printingOf`  | Why an instruction has no text; `printingOf` gives the text or the reason in one call                       |
| `registerEffect(insn)`                     | The registers the instruction writes, and the ones the written value comes from                             |

Every address operand is named through `labelFor`: the printer never invents a name.

### When an instruction prints as `.inst`

`format` prints a mnemonic only when that text assembles back to the instruction's bytes. Otherwise
`rawReason` says why:

| Reason          | Meaning                                                                 |
| --------------- | ----------------------------------------------------------------------- |
| `undefined`     | no ARMv4T instruction has this encoding                                 |
| `unpredictable` | the architecture leaves the behaviour open, and `as` refuses the text   |
| `sbz-set`       | a should-be-zero bit is set, which no text expresses                    |
| `as-alias`      | `as` assembles this text to another encoding of the same instruction    |
| `bl-half`       | one half of a Thumb `bl` without the other: an instruction with no text |
| `no-roundtrip`  | the text did not assemble back (an address has no label, for example)   |

Coprocessor instructions (`cdp`, `mrc`, `mcr`, `ldc`, `stc`) are not printed as mnemonics: the tables
describe a core with no coprocessor, such as the ARM7TDMI, where they trap as undefined. They print as
`.inst`, with the reason `undefined`.

### When a text does not assemble

```ts
const result = assembleText('b nowhere', 'thumb', 0x0800_0000, names);
if (!result.ok) describeAssembleFailure(result.failure); // "the label 'nowhere' has no address"
```

A failure is one of `unknown-mnemonic`, `unknown-label`, `operands` (with the forms the mnemonic takes) or
`not-encodable` (out of range, misaligned, or refused by `as`).

### What an instruction does

`insn.flow` says where control goes: `next`, `branch`, `bl`, `return`, `indirect`, `pool-load`, `adr`, `swi`,
`mode-switch` or `invalid`. `registerEffect(insn)` gives what the instruction itself writes: a call writes
`lr`, and what the callee does to other registers is a calling convention for the caller to add.
`specOf(insn.specId).stack?.(insn.fields)` is the change to `sp` in bytes.

### The tables

One table per instruction set drives everything above. `ROWS`, `rowOf`, `rowFor`, `specOf` and
`specsOf` expose its rows, and `isThumbBlPrefix`, `isThumbBlSuffix` and `thumbMayReference` are quick tests
on a Thumb halfword. An unknown row id throws `IsaInvariantError`.

## How it is checked

The tests pin the printed text and control flow of every Thumb halfword and of seeded samples of `bl`
pairs and ARM words, on Node, Bun and Chromium. That text was also assembled with GNU as 2.45
(`-mcpu=arm7tdmi`) for every Thumb halfword and over a million ARM words, and gave back the same bytes.

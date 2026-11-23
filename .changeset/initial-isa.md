---
'@match-kit/isa': minor
---

First release: instruction sets for decompilation tools, starting with ARMv4T (ARM and Thumb) at `@match-kit/isa/armv4t`. It decodes instructions, prints them as GNU as unified syntax that assembles back to the same bytes (or as `.inst` when no text does), parses that text and encodes it. It also gives each instruction's operands, control flow and the registers it writes, and says why a text does not assemble. Runs on Node, Bun and browsers, with no dependencies.

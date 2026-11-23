// A readable sample of the tables' output, kept as text: for every row, its own match bits when they decode to it
// and three seeded encodings that do (the PC-relative Thumb rows at both alignments), with the row, the printed
// text or its `.inst` line, and the control flow. golden.ts pins all of the output as digests; this is the part a
// person can read, so a change shows as a diff of instructions. `pnpm test -u` rewrites the files.
import { expect, test } from 'vitest';

import { type Mode, decode, format, formatRaw, rawReason, specsOf } from '../../src/armv4t.js';
import { prngSequence } from './prng.js';
import { LABELS } from './resolver.js';

const VARIANTS = 3;
const ADDRESS_FLOWS = new Set(['branch', 'cond-branch', 'bl', 'pool-load', 'adr']);
const hex = (value: number, digits: number): string => value.toString(16).toUpperCase().padStart(digits, '0');

function listing(mode: Mode): string {
  const random = prngSequence(mode === 'thumb' ? 0x7407 : 0xa404, 1 << 16);
  let at = 0;
  const lines: string[] = [];
  for (const spec of specsOf(mode)) {
    const words = decode(mode, spec.match, 0x0800_0000).specId === spec.id ? [spec.match] : [];
    for (let attempt = 0; words.length <= VARIANTS && attempt < 256; attempt++) {
      const word = (((random[at++ % random.length] ?? 0) & ~spec.mask) | spec.match) >>> 0;
      const sized = spec.size === 2 ? word & 0xffff : word;
      if (decode(mode, sized, 0x0800_0000).specId === spec.id && !words.includes(sized)) {
        words.push(sized);
      }
    }
    const addrs = mode === 'thumb' && ADDRESS_FLOWS.has(spec.flow) ? [0x0800_0000, 0x0800_0002] : [0x0800_0000];
    for (const word of words) {
      for (const addr of addrs) {
        const insn = decode(mode, word, addr);
        const text = rawReason(insn, LABELS) === null ? (format(insn, LABELS) ?? '') : formatRaw(insn);
        const flow = insn.flow.kind === 'next' ? '' : `  ; ${insn.flow.kind}`;
        lines.push(
          `${hex(addr, 8)} ${hex(insn.word, insn.size * 2).padEnd(8)} ${insn.specId.padEnd(26)} ${text}${flow}`,
        );
      }
    }
  }
  return `${lines.join('\n')}\n`;
}

test.each(['thumb', 'arm'] as const)('the %s listing matches its file', async (mode) => {
  await expect(listing(mode)).toMatchFileSnapshot(`./listing/${mode}.txt`);
});

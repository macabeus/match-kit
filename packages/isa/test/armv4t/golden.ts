// The printed output of the tables, pinned: one line per instruction (its text under the printing rule, or its
// `.inst` line, then its row and control flow) for every Thumb halfword at both alignments, a seeded sample of bl
// pairs and a seeded sample of ARM words, hashed. A change to any row, codec or spelling moves a digest, so it
// cannot land unnoticed; a deliberate one updates GOLDEN in the same commit and says why.
import { type Insn, decode, formatRaw, printing } from '../../src/armv4t.js';
import { prngSequence } from './prng.js';
import { LABELS } from './resolver.js';

export const GOLDEN = {
  thumb: '73687b460f0508d9ddda2ea47d66f0d6d03b8473fb133cb88f8823994a3f4282',
  bl: 'ab6b3e28c3f3a049c726523192f4c82904591a21bbc6149668d65a589659828f',
  arm: '5a276fc8bfd1b58c77e2b7c2d9f982537834d497cc4305f82dbf37b8b650a50c',
} as const;

function line(insn: Insn): string {
  const printed = printing(insn, LABELS);
  const text = printed.kind === 'mnemonic' ? printed.text : formatRaw(insn);
  return `${text}\t${insn.specId}\t${JSON.stringify(insn.flow)}\n`;
}

async function sha256(parts: readonly string[]): Promise<string> {
  const bytes = new TextEncoder().encode(parts.join(''));
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The digests of the three samples, computed from the tables as they are now. */
export async function goldenDigests(): Promise<Record<keyof typeof GOLDEN, string>> {
  const thumb: string[] = [];
  for (const addr of [0x0800_0000, 0x0800_0002]) {
    for (let hw = 0; hw < 0x10000; hw++) {
      thumb.push(line(decode('thumb', hw, addr)));
    }
  }
  const bl: string[] = [];
  for (const r of prngSequence(0xb1, 1 << 14)) {
    const word = (0xf000 | (r & 0x7ff) | ((0xf800 | ((r >>> 11) & 0x7ff)) << 16)) >>> 0;
    bl.push(line(decode('thumb', word, 0x0800_0000 + (r & 2))));
  }
  const arm: string[] = [];
  for (const word of prngSequence(0xa5a5_a5a5, 1 << 18)) {
    arm.push(line(decode('arm', word, 0x0800_0000)));
  }
  return { thumb: await sha256(thumb), bl: await sha256(bl), arm: await sha256(arm) };
}

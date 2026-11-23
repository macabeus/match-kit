// The printing rule against the real assembler: every instruction the tables print as a mnemonic is assembled
// with GNU as (`arm-none-eabi-as -mcpu=arm7tdmi`) and must give back its own bytes. The cases are every Thumb
// halfword at both alignments, a seeded sample of bl pairs and a seeded sample of ARM words.
//
// The test needs binutils, so it is skipped where `arm-none-eabi-as` is not on the PATH; CI has a job that
// installs it and sets REQUIRE_GNU_AS=1, which turns a missing assembler into a failure.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';

import { type Insn, type Mode, type SymbolResolver, decode, format, rawReason } from '../../src/armv4t.js';
import { prngSequence } from './prng.js';

const AS = 'arm-none-eabi-as';
const OBJCOPY = 'arm-none-eabi-objcopy';
const BASE = 0x0800_0000;

const available = spawnSync(AS, ['--version']).status === 0 && spawnSync(OBJCOPY, ['--version']).status === 0;
const required = process.env['REQUIRE_GNU_AS'] === '1';

interface Case {
  readonly mode: Mode;
  /** Where the instruction lies in the assembled section. */
  readonly offset: number;
  readonly insn: Insn;
  readonly text: string;
}

/**
 * One assembly file of cases. Each instruction is followed by a label of its own; an address it names is that
 * label plus the distance (`.set`), which GNU as resolves on the spot since both lie in one section, wherever
 * the address falls.
 */
class Listing {
  readonly lines: string[] = ['.syntax unified', '.text'];
  readonly cases: Case[] = [];
  #offset = 0;
  #mode: Mode | undefined;

  /** Adds the instruction of `word` at an address that is `alignment` modulo 4, when it prints as a mnemonic. */
  add(mode: Mode, word: number, alignment: 0 | 2): void {
    this.#offset = (this.#offset + 3) & ~3;
    const offset = this.#offset + alignment;
    const insn = decode(mode, word, BASE + offset);
    const index = this.cases.length;
    const targets: number[] = [];
    const resolver: SymbolResolver = {
      labelFor: (target) => {
        targets.push(target);
        return `target_${index}`;
      },
      addressOf: (name) => (name === `target_${index}` ? targets[0] : undefined),
    };
    if (rawReason(insn, resolver) !== null) {
      return;
    }
    const text = format(insn, resolver);
    if (text === undefined) {
      return;
    }
    if (this.#mode !== mode) {
      this.lines.push(mode === 'thumb' ? '.thumb' : '.arm');
      this.#mode = mode;
    }
    this.lines.push('.balign 4');
    if (alignment === 2) {
      this.lines.push('.inst.n 0x46c0');
    }
    this.lines.push(`here_${index}:`);
    const target = targets[0];
    if (target !== undefined) {
      this.lines.push(`.set target_${index}, here_${index} + ${target - insn.addr}`);
    }
    this.lines.push(text);
    this.cases.push({ mode, offset, insn, text });
    this.#offset = offset + insn.size;
  }
}

function assemble(listing: Listing): Uint8Array {
  const dir = mkdtempSync(join(tmpdir(), 'match-kit-isa-'));
  try {
    writeFileSync(join(dir, 'cases.s'), `${listing.lines.join('\n')}\n`);
    execFileSync(AS, ['-mcpu=arm7tdmi', '-o', join(dir, 'cases.o'), join(dir, 'cases.s')], { stdio: 'pipe' });
    execFileSync(OBJCOPY, ['-O', 'binary', '-j', '.text', join(dir, 'cases.o'), join(dir, 'cases.bin')]);
    return readFileSync(join(dir, 'cases.bin'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The cases whose assembled bytes are not the instruction's own, as readable lines. */
function disagreements(listing: Listing, bytes: Uint8Array): string[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: string[] = [];
  for (const { mode, offset, insn, text } of listing.cases) {
    const assembled =
      insn.size === 2
        ? view.getUint16(offset, true)
        : mode === 'thumb'
          ? (view.getUint16(offset, true) | (view.getUint16(offset + 2, true) << 16)) >>> 0
          : view.getUint32(offset, true);
    if (assembled !== insn.word) {
      out.push(
        `${mode} 0x${insn.word.toString(16)} prints '${text}', which as assembles to 0x${assembled.toString(16)}`,
      );
    }
  }
  return out;
}

test.skipIf(!available && !required)(
  'GNU as assembles every printed mnemonic back to its bytes',
  () => {
    expect(available, `${AS} and ${OBJCOPY} must be on the PATH (REQUIRE_GNU_AS=1)`).toBe(true);
    const listing = new Listing();
    for (const alignment of [0, 2] as const) {
      for (let hw = 0; hw < 0x10000; hw++) {
        listing.add('thumb', hw, alignment);
      }
    }
    for (const r of prngSequence(0xb1, 1 << 13)) {
      const pair = (0xf000 | (r & 0x7ff) | ((0xf800 | ((r >>> 11) & 0x7ff)) << 16)) >>> 0;
      listing.add('thumb', pair, r & 2 ? 2 : 0);
    }
    for (const word of prngSequence(0xa5a5_a5a5, 1 << 17)) {
      listing.add('arm', word, 0);
    }
    const wrong = disagreements(listing, assemble(listing));
    expect(wrong.slice(0, 20)).toEqual([]);
    // The sample is not vacuous: most of Thumb prints, and so does about half of a random ARM sample.
    expect(listing.cases.filter((c) => c.mode === 'thumb').length).toBeGreaterThan(110_000);
    expect(listing.cases.filter((c) => c.mode === 'arm').length).toBeGreaterThan(50_000);
  },
  120_000,
);

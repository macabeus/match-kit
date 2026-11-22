// Seeded properties of the tables: decode∘encode is the identity on every row's
// legal fields; every Thumb halfword and a seeded ARM sample either round-trips or has a raw reason;
// parse reads back every printed text.
import { assert, test } from 'vitest';

import {
  type Insn,
  type InsnSpec,
  type Mode,
  RAW_REASONS,
  type RawReason,
  decode,
  encode,
  format,
  formatRaw,
  parse,
  rawReason,
  roundTrips,
  rowOrder,
  specsOf,
} from '../../src/armv4t.js';
import { check } from './check.js';
import { prngSequence } from './prng.js';
import { LABELS } from './resolver.js';

const TRIALS = 96;

function coversAllBits(spec: InsnSpec): boolean {
  let bits = spec.mask;
  for (const f of spec.fields) {
    bits = (bits | ((2 ** f.width - 1) * 2 ** f.lo)) >>> 0;
  }
  return bits === (spec.size === 2 ? 0xffff : 0xffff_ffff);
}

test('decode(encode(spec, fields)) gives back the spec and fields, or a row listed before it', () => {
  for (const mode of ['thumb', 'arm'] as const satisfies readonly Mode[]) {
    const random = prngSequence(0x1234_5678, 1 << 20);
    let at = 0;
    for (const spec of specsOf(mode)) {
      let hits = 0;
      for (let trial = 0; trial < TRIALS; trial++) {
        const fields: Record<string, number> = {};
        for (const field of spec.fields) {
          fields[field.name] = (random[at++ % random.length] ?? 0) % 2 ** field.width;
        }
        const word = encode(spec, fields);
        // Legal fields agree with the bits the row fixes (pc in ldm_pc's list, rd = pc in a pc row).
        if (spec.fields.some((f) => Math.floor(word / 2 ** f.lo) % 2 ** f.width !== fields[f.name])) {
          continue;
        }
        const insn = decode(mode, word, 0x0800_0000);
        if (insn.specId === spec.id) {
          hits++;
          assert.deepEqual(insn.fields, fields, `${spec.id}: fields`);
        } else {
          // First row wins: a more specific earlier row may claim these fields.
          assert.ok(rowOrder(insn.specId) < rowOrder(spec.id), `${spec.id}: decoded as the later row ${insn.specId}`);
        }
      }
      // Rows whose fields name every free bit must be reachable; the others are spaces (undefined
      // encodings, the catch-alls) that take whatever earlier rows leave over.
      if (coversAllBits(spec)) {
        assert.ok(hits > 0, `${spec.id}: no random fields decode to it`);
      }
    }
  }
});

function checkPrinting(insn: Insn, counts: Record<RawReason, number>): void {
  const reason = rawReason(insn, LABELS);
  const where = (): string => `${insn.mode} 0x${insn.word.toString(16)} at 0x${insn.addr.toString(16)}`;
  if (reason === null) {
    const text = format(insn, LABELS);
    check(text !== undefined, () => `${where()}: printable but no text`);
    check(parse(text, insn.mode, insn.addr, LABELS) !== undefined, () => `${where()}: parse('${text}')`);
    check(roundTrips(insn, LABELS), () => `${where()}: '${text}' does not round-trip`);
  } else {
    check(RAW_REASONS.includes(reason), () => `${where()}: reason ${reason}`);
    const raw = formatRaw(insn);
    const shape = insn.mode === 'arm' ? /^\.inst 0x[0-9A-F]{8} @ / : /^\.inst\.[nw] 0x[0-9A-F]{4,8} @ /;
    check(shape.test(raw), () => `${where()}: '${raw}'`);
    counts[reason]++;
  }
}

function zero(): Record<RawReason, number> {
  return { undefined: 0, unpredictable: 0, 'sbz-set': 0, 'as-alias': 0, 'bl-half': 0, 'no-roundtrip': 0 };
}

test('every Thumb halfword at both alignments round-trips or has a raw reason', () => {
  const counts = zero();
  for (const addr of [0x0800_0000, 0x0800_0002]) {
    for (let hw = 0; hw < 0x10000; hw++) {
      checkPrinting(decode('thumb', hw, addr), counts);
    }
  }
  // Every Thumb raw instruction is raw for a row reason; none falls back on a failed round trip.
  assert.strictEqual(counts['no-roundtrip'], 0);
});

test('bl pairs round-trip', () => {
  const counts = zero();
  for (const r of prngSequence(0xb1, 4096)) {
    const word = (0xf000 | (r & 0x7ff) | ((0xf800 | ((r >>> 11) & 0x7ff)) << 16)) >>> 0;
    checkPrinting(decode('thumb', word, 0x0800_0000 + (r & 2)), counts);
  }
  assert.deepEqual(counts, zero());
});

test('a seeded ARM sample round-trips or has a raw reason', () => {
  const counts = zero();
  for (const word of prngSequence(0xa5a5_a5a5, 1 << 16)) {
    checkPrinting(decode('arm', word, 0x0800_0000), counts);
  }
  assert.ok(counts.undefined > 0 && counts.unpredictable > 0 && counts['sbz-set'] > 0);
});

// assembleText: parse and assemble in one call, with the reason when a text has no encoding; and operandsOf.
import { describe, expect, it } from 'vitest';

import { assembleText, decode, describeAssembleFailure, operandsOf } from '../../src/armv4t.js';
import { LABELS } from './resolver.js';

const A = 0x0800_0000;

describe('assembleText', () => {
  it('gives the encoding GNU as picks', () => {
    expect(assembleText('adds r0, r0, #1', 'thumb', A, LABELS)).toEqual({
      ok: true,
      specId: 'thumb.add_imm8',
      size: 2,
      word: 0x3001,
    });
    expect(assembleText('bl _08000004', 'thumb', A, LABELS)).toMatchObject({ ok: true, size: 4, word: 0xf800_f000 });
  });

  it('names a mnemonic no instruction has', () => {
    const result = assembleText('frobnicate r0', 'thumb', A, LABELS);
    expect(result).toEqual({ ok: false, failure: { kind: 'unknown-mnemonic', mnemonic: 'frobnicate' } });
    expect(result.ok ? '' : describeAssembleFailure(result.failure)).toBe("no instruction is spelled 'frobnicate'");
  });

  it('names a label the resolver does not know', () => {
    expect(assembleText('b nowhere', 'thumb', A, LABELS)).toEqual({
      ok: false,
      failure: { kind: 'unknown-label', label: 'nowhere' },
    });
  });

  it('lists the forms a mnemonic takes when the operands fit none', () => {
    const result = assembleText('push r4', 'thumb', A, LABELS);
    expect(result).toEqual({
      ok: false,
      failure: { kind: 'operands', mnemonic: 'push', syntaxes: ['push {reglist}'] },
    });
    expect(result.ok ? '' : describeAssembleFailure(result.failure)).toBe(
      "'push' takes other operands: push {reglist}",
    );
    // A mode has its own mnemonics: ARM has no push.
    expect(assembleText('push {r4}', 'arm', A, LABELS)).toMatchObject({ failure: { kind: 'unknown-mnemonic' } });
  });

  it('says which rows read the text when none encodes it: out of range, misaligned, or refused by as', () => {
    expect(assembleText('b _08000804', 'thumb', A, LABELS)).toEqual({
      ok: false,
      failure: { kind: 'not-encodable', candidates: ['thumb.bcc', 'thumb.b'] },
    });
    expect(assembleText('mov r0, #0x101', 'arm', A, LABELS)).toMatchObject({ failure: { kind: 'not-encodable' } });
    expect(assembleText('mov r0, r1', 'thumb', A, LABELS)).toMatchObject({ failure: { kind: 'not-encodable' } });
  });
});

describe('operandsOf', () => {
  it('gives what the text says as numbers: registers, immediates in bytes, addresses', () => {
    expect(operandsOf(decode('thumb', 0x6848, A))).toEqual({ rd: 0, rn: 1, imm: 4 });
    expect(operandsOf(decode('thumb', 0x4802, A))).toEqual({ rd: 0, target: 0x0800_000c });
    expect(operandsOf(decode('thumb', 0xb5f0, A))).toEqual({ reglist: 0x40f0 });
    expect(operandsOf(decode('arm', 0xe1a0_0081, A))).toEqual({ cond: 14, s: 0, rd: 0, rm: 1, shift: 0, amount: 1 });
  });

  it('reads a hi register as the text names it, not as its split bits', () => {
    const insn = decode('thumb', 0x46c0, A);
    expect(insn.fields).toEqual({ h1: 1, h2: 1, rm3: 0, rd3: 0 });
    expect(operandsOf(insn)).toEqual({ rd: 8, rm: 8 });
  });
});

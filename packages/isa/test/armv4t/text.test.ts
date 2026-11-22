// The text side of the printer: format's label rule, formatRaw, parse's grammar, and the choices
// assemble makes the way GNU as does (each one confirmed against `as` by the corpus).
import { assert, test } from 'vitest';

import {
  type Mode,
  assemble,
  decode,
  format,
  formatDecoding,
  formatRaw,
  parse,
  rawReason,
  roundTrips,
  specOf,
} from '../../src/armv4t.js';
import { LABELS, NO_LABELS } from './resolver.js';

function asm(mode: Mode, text: string, addr = 0x0800_0000): number | undefined {
  const parsed = parse(text, mode, addr, LABELS);
  return parsed === undefined ? undefined : assemble(parsed, addr)?.word;
}

test('format names every address through the resolver and gives nothing without a label', () => {
  const branch = decode('thumb', 0xe7fe, 0x0800_0000);
  assert.strictEqual(format(branch, LABELS), 'b _08000000');
  assert.strictEqual(format(branch, NO_LABELS), undefined);
  assert.strictEqual(roundTrips(branch, NO_LABELS), false);
  assert.strictEqual(rawReason(branch, NO_LABELS), 'no-roundtrip');
  const from: number[] = [];
  format(branch, { labelFor: (_a, f) => (from.push(f), 'here'), addressOf: () => undefined });
  assert.deepEqual(from, [0x0800_0000]);
});

test('format gives nothing for a raw row', () => {
  assert.strictEqual(format(decode('thumb', 0xde00, 0x0800_0000), LABELS), undefined);
  assert.strictEqual(format(decode('thumb', 0x1c40, 0x0800_0000), LABELS), undefined);
});

test('formatRaw spells the bytes and the decoding, never a label', () => {
  assert.strictEqual(formatRaw(decode('thumb', 0x1c40, 0x0800_0000)), '.inst.n 0x1C40 @ adds r0, r0, #1 (as-alias)');
  assert.strictEqual(formatRaw(decode('thumb', 0xe7fe, 0x0800_0000)), '.inst.n 0xE7FE @ b 0x08000000');
  assert.strictEqual(formatRaw(decode('thumb', 0xf000, 0x0800_0000)), '.inst.n 0xF000 @ bl prefix');
  assert.strictEqual(formatRaw(decode('thumb', 0xf800_f000, 0x0800_0000)), '.inst.w 0xF000F800 @ bl 0x08000004');
  assert.strictEqual(
    formatRaw(decode('arm', 0xe51f_0000, 0x0800_0000)),
    '.inst 0xE51F0000 @ ldr r0, 0x08000008 (as-alias)',
  );
  assert.strictEqual(formatRaw(decode('arm', 0xee00_0000, 0x0800_0000)), '.inst 0xEE000000 @ coprocessor');
});

test('formatDecoding prints an instruction that has a raw reason, and nothing for a row without text', () => {
  const alias = decode('thumb', 0x1c40, 0x0800_0000);
  assert.strictEqual(format(alias, LABELS), undefined);
  assert.strictEqual(formatDecoding(alias, LABELS), 'adds r0, r0, #1');
  assert.strictEqual(formatDecoding(decode('thumb', 0x0808, 0x0800_0000), LABELS), 'lsrs r0, r1, #0x20');
  assert.strictEqual(formatDecoding(decode('arm', 0xe4b1_0004, 0x0800_0000), LABELS), 'ldrt r0, [r1], #4');
  assert.strictEqual(
    formatDecoding(decode('thumb', 0xe7fe, 0x0800_0000), { labelFor: (a) => `0x${a.toString(16)}` }),
    'b 0x8000000',
  );
  assert.strictEqual(formatDecoding(decode('thumb', 0xe7fe, 0x0800_0000), NO_LABELS), undefined);
  assert.strictEqual(formatDecoding(decode('thumb', 0xde00, 0x0800_0000), LABELS), undefined);
  assert.strictEqual(formatDecoding(decode('thumb', 0xf000, 0x0800_0000), LABELS), undefined);
});

test('parse reads the printed grammar, with spacing, case and comments normalised', () => {
  const parsed = parse('  PUSH   { r4 ,lr }   @ save', 'thumb', 0x0800_0000, LABELS);
  assert.ok(parsed !== undefined);
  assert.strictEqual(parsed.mnemonic, 'push');
  assert.strictEqual(parsed.text, 'PUSH {r4, lr}');
  assert.deepEqual(parsed.candidates, [{ specId: 'thumb.push', operands: { list: 0x4010 } }]);
  assert.strictEqual(parse('frobnicate r0', 'thumb', 0x0800_0000, LABELS), undefined);
  assert.strictEqual(parse('b nowhere', 'thumb', 0x0800_0000, LABELS), undefined);
  assert.strictEqual(parse('ldr r0, [r1', 'arm', 0x0800_0000, LABELS), undefined);
  assert.strictEqual(parse('push {r4, r4}', 'thumb', 0x0800_0000, LABELS), undefined);
});

test('assemble follows asPriority: adds rd, rd, #imm takes the 8-bit form', () => {
  assert.strictEqual(specOf('thumb.add_imm8').asPriority < specOf('thumb.add_imm3').asPriority, true);
  assert.strictEqual(asm('thumb', 'adds r0, r0, #1'), 0x3001);
  assert.strictEqual(asm('thumb', 'adds r0, r1, #1'), 0x1c48);
  assert.strictEqual(asm('thumb', 'adds r0, r0, #9'), 0x3009);
  assert.strictEqual(asm('thumb', 'subs r2, r2, #7'), 0x3a07);
});

test('assemble picks the low-register ALU form, the hi form only with a hi register', () => {
  assert.strictEqual(asm('thumb', 'cmp r0, r1'), 0x4288);
  assert.strictEqual(asm('thumb', 'cmp r8, r1'), 0x4588);
  assert.strictEqual(asm('thumb', 'mov r8, r8'), 0x46c0);
  // as rejects these on the ARMv4T, and so does assemble.
  assert.strictEqual(asm('thumb', 'mov r0, r1'), undefined);
  assert.strictEqual(asm('thumb', 'cmp r0, pc'), undefined);
  assert.strictEqual(asm('thumb', 'push {}'), undefined);
  // as turns `ldmia r0, {r0}` into `ldr r0, [r0]`.
  assert.strictEqual(asm('thumb', 'ldmia r0, {r0}'), undefined);
});

test('PC-relative Thumb forms count from Align(addr + 4, 4) and stop at their range', () => {
  assert.strictEqual(asm('thumb', 'ldr r0, _08000004', 0x0800_0000), 0x4800);
  assert.strictEqual(asm('thumb', 'ldr r0, _08000004', 0x0800_0002), 0x4800);
  assert.strictEqual(asm('thumb', 'ldr r0, _08000400', 0x0800_0000), 0x48ff);
  assert.strictEqual(asm('thumb', 'ldr r0, _08000404', 0x0800_0000), undefined);
  assert.strictEqual(asm('thumb', 'ldr r0, _08000006', 0x0800_0000), undefined);
  assert.strictEqual(asm('thumb', 'ldr r0, _08000000', 0x0800_0000), undefined);
  assert.strictEqual(asm('thumb', 'adr r1, _08000008', 0x0800_0002), 0xa101);
});

test('branch ranges: b ±2 KiB, bcc ±256 bytes, bl ±4 MiB, ARM b ±32 MiB', () => {
  assert.strictEqual(asm('thumb', 'b _08000802'), 0xe3ff);
  assert.strictEqual(asm('thumb', 'b _08000804'), undefined);
  assert.strictEqual(asm('thumb', 'b _07FFF804'), 0xe400);
  assert.strictEqual(asm('thumb', 'b _07FFF802'), undefined);
  assert.strictEqual(asm('thumb', 'b _08000003'), undefined);
  assert.strictEqual(asm('thumb', 'beq _08000102'), 0xd07f);
  assert.strictEqual(asm('thumb', 'beq _08000104'), undefined);
  assert.strictEqual(asm('thumb', 'bl _08400002'), 0xffff_f3ff);
  assert.strictEqual(asm('thumb', 'bl _08400004'), undefined);
  assert.strictEqual(asm('arm', 'b _0A000004'), 0xea7f_ffff);
  assert.strictEqual(asm('arm', 'b _0A000008'), undefined);
  assert.strictEqual(asm('arm', 'blne _06000008'), 0x1b80_0000);
});

test('ARM immediates take the smallest rotation unless the text spells one', () => {
  assert.strictEqual(asm('arm', 'mov r0, #0x40000000'), 0xe3a0_0101);
  assert.strictEqual(asm('arm', 'mov r0, #4, 2'), 0xe3a0_0104);
  assert.strictEqual(asm('arm', 'mov r0, #0x101'), undefined);
  assert.strictEqual(asm('arm', 'msr cpsr_f, #4, 2'), undefined);
});

test('ARM adr: add for a forward label, sub for a backward one', () => {
  assert.strictEqual(asm('arm', 'adr r0, _0800000C'), 0xe28f_0004);
  assert.strictEqual(asm('arm', 'adr r0, _08000008'), 0xe28f_0000);
  assert.strictEqual(asm('arm', 'adr r0, _08000004'), 0xe24f_0004);
  assert.strictEqual(asm('arm', 'adr r0, _08000009'), 0xe28f_0001);
  assert.strictEqual(asm('arm', 'adr r0, _08000109'), undefined);
  // `add rd, pc, #v` with v of 2^31 or more becomes a sub (or an error) in as.
  assert.strictEqual(asm('arm', 'add pc, pc, #0x80000000'), undefined);
  assert.strictEqual(asm('arm', 'adds pc, pc, #0x80000000'), 0xe29f_f102);
});

test('ARM pool loads use pc + 8 in both directions', () => {
  assert.strictEqual(asm('arm', 'ldr r0, _08001007'), 0xe59f_0fff);
  assert.strictEqual(asm('arm', 'ldr r0, _07FFF009'), 0xe51f_0fff);
  assert.strictEqual(asm('arm', 'ldr r0, _08001008'), undefined);
  assert.strictEqual(asm('arm', 'ldr pc, [pc, #3]'), undefined);
});

test('assemble names the row the word decodes to', () => {
  const parsed = parse('mov pc, lr', 'arm', 0x0800_0000, LABELS);
  assert.ok(parsed !== undefined);
  assert.deepEqual(assemble(parsed, 0x0800_0000), { specId: 'arm.mov_ims_pc', size: 4, word: 0xe1a0_f00e });
});

import type * as ObjdiffWasm from 'objdiff-wasm';
import { expect, test } from 'vitest';

import { rowText } from '../src/scorer/row-text.js';

type Text = ObjdiffWasm.display.DiffText;
// objdiff-wasm's generated types give the opcode and symbol payloads the same names as their
// variants (`DiffTextOpcode`, `DiffTextSymbol`), and TypeScript merges each pair: a segment written
// as the engine returns it does not type-check without this cast.
const merged = (text: object) => text as Text;
const row = (...texts: Text[]): ObjdiffWasm.display.InstructionDiffRow => ({
  diffKind: 'none',
  segments: texts.map((text) => ({ text, color: { tag: 'normal' }, padTo: 0 })),
});

test('an instruction: opcode, registers, immediates', () => {
  expect(
    rowText(
      row(
        { tag: 'address', val: 0x10n },
        merged({ tag: 'opcode', val: { mnemonic: 'add', opcode: 0 } }),
        { tag: 'basic', val: 'r0, ' },
        { tag: 'signed', val: -4n },
        { tag: 'basic', val: ', ' },
        { tag: 'unsigned', val: 255n },
        { tag: 'eol' },
      ),
    ),
  ).toBe('add r0, -0x4, 0xff');
});

test('branch targets become labels, and line numbers are left out', () => {
  expect(
    rowText(
      row(
        { tag: 'line', val: 42 },
        merged({ tag: 'opcode', val: { mnemonic: 'b', opcode: 0 } }),
        { tag: 'branch-dest', val: 0x2an },
        { tag: 'branch-arrow', val: 1 },
      ),
    ),
  ).toBe('b .L2a');
});

test('symbols prefer their demangled name; addends carry their sign', () => {
  expect(
    rowText(
      row(
        merged({ tag: 'symbol', val: { name: 'inc__7CounterFv', demangledName: 'Counter::inc()' } }),
        { tag: 'addend', val: 8n },
        { tag: 'basic', val: ' ' },
        merged({ tag: 'symbol', val: { name: 'gCount' } }),
        { tag: 'addend', val: -8n },
      ),
    ),
  ).toBe('Counter::inc()+0x8 gCount-0x8');
});

test('a reference is marked, and its closing paren dropped', () => {
  expect(
    rowText(
      row(
        merged({ tag: 'opcode', val: { mnemonic: 'ldr', opcode: 0 } }),
        { tag: 'basic', val: 'r0' },
        { tag: 'basic', val: ' (->' },
        merged({ tag: 'symbol', val: { name: 'gData' } }),
        { tag: 'basic', val: ')' },
      ),
    ),
  ).toBe('ldr r0 # REFERENCE_gData');
});

test('padTo pads the current line to a column', () => {
  const padded: ObjdiffWasm.display.InstructionDiffRow = {
    diffKind: 'none',
    segments: [
      { text: merged({ tag: 'opcode', val: { mnemonic: 'mov', opcode: 0 } }), color: { tag: 'normal' }, padTo: 8 },
      { text: { tag: 'basic', val: 'r0' }, color: { tag: 'normal' }, padTo: 0 },
    ],
  };
  expect(rowText(padded)).toBe('mov     r0');
});

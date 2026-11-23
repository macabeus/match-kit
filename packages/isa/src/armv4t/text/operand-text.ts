// The spelling of operands in GNU as unified syntax: register names, condition suffixes, immediates,
// register lists, shifts and status-register fields. Every printer and parser of operand text uses
// these, so the grammar the formatter writes is exactly the grammar the parser reads.

const REGISTERS: readonly string[] = [
  'r0',
  'r1',
  'r2',
  'r3',
  'r4',
  'r5',
  'r6',
  'r7',
  'r8',
  'r9',
  'r10',
  'r11',
  'r12',
  'sp',
  'lr',
  'pc',
];

/** Extra register spellings the parser accepts (the formatter writes only REGISTERS). */
const REGISTER_ALIASES: Readonly<Record<string, number>> = { r13: 13, r14: 14, r15: 15, ip: 12, fp: 11 };

/** The name of register `n` (0..15). */
export function regName(n: number): string {
  return REGISTERS[n] ?? `r${n}`;
}

/** The number of a register name, or undefined. */
export function regNumber(name: string): number | undefined {
  const index = REGISTERS.indexOf(name);
  return index >= 0 ? index : REGISTER_ALIASES[name];
}

/** Condition suffixes by condition code; 14 (always) prints as no suffix, 15 never prints. */
export const CONDITIONS: readonly string[] = [
  'eq',
  'ne',
  'cs',
  'cc',
  'mi',
  'pl',
  'vs',
  'vc',
  'hi',
  'ls',
  'ge',
  'lt',
  'gt',
  'le',
  '',
];

/** An unsigned immediate: decimal below 10, otherwise lower-case 0x hex. */
export function num(v: number): string {
  return v < 10 ? String(v) : `0x${v.toString(16)}`;
}

/** The value of a number written by `num` (or any decimal / 0x hex spelling); undefined when malformed. */
export function parseNum(text: string): number | undefined {
  if (/^0x[0-9a-fA-F]+$/.test(text)) {
    return Number.parseInt(text.slice(2), 16);
  }
  if (/^[0-9]+$/.test(text)) {
    return Number.parseInt(text, 10);
  }
  return undefined;
}

/** A register list `{r0, r4, lr}` from a 16-bit mask, registers in ascending order. */
export function regList(mask: number): string {
  const names: string[] = [];
  for (let r = 0; r < 16; r++) {
    if ((mask >>> r) & 1) {
      names.push(regName(r));
    }
  }
  return `{${names.join(', ')}}`;
}

/** The mask of the text between the braces of a register list; undefined when malformed or repeated. */
export function parseRegList(inner: string): number | undefined {
  if (inner === '') {
    return 0;
  }
  let mask = 0;
  for (const name of inner.split(', ')) {
    const r = regNumber(name);
    if (r === undefined || (mask >>> r) & 1) {
      return undefined;
    }
    mask |= 1 << r;
  }
  return mask >>> 0;
}

/** Shift mnemonics by ARM shift type; type 4 stands for rrx. */
export const SHIFTS: readonly string[] = ['lsl', 'lsr', 'asr', 'ror', 'rrx'];

/** The `shift` operand value that stands for rrx (encoded as ror #0). */
export const SHIFT_RRX = 4;

/** Status-register field letters in the order GNU as prints them, with their mask bits. */
const PSR_FIELDS: readonly (readonly [string, number])[] = [
  ['f', 8],
  ['s', 4],
  ['x', 2],
  ['c', 1],
];

/** `cpsr_fc`-style text for an msr field mask (1..15). */
export function psrFields(mask: number): string {
  return PSR_FIELDS.filter(([, bit]) => (mask & bit) !== 0)
    .map(([letter]) => letter)
    .join('');
}

/** The mask of msr field letters; undefined when a letter repeats or is unknown. */
export function parsePsrFields(letters: string): number | undefined {
  let mask = 0;
  for (const letter of letters) {
    const bit = PSR_FIELDS.find(([l]) => l === letter)?.[1];
    if (bit === undefined || (mask & bit) !== 0) {
      return undefined;
    }
    mask |= bit;
  }
  return mask;
}

// Syntax templates: 'ldr{c} {rd}, {amode}'. A template is GNU as unified syntax with operand
// placeholders in braces; the text before the first space is the mnemonic. `compileForm` turns one
// into a renderer (operand values to text) and a reader (text back to operand values) that share one
// placeholder table, so `parse` reads exactly the grammar `format` writes.
//
// Placeholders and the operand names they read or write:
//   mnemonic: {c} cond (14 prints nothing), {s} s, {am} p and u (ia ib da db)
//   operands: {rd} {rn} {rm} {rs} {rdlo} {rdhi} registers; {imm} '#n'; {off} ', #n' or nothing when 0;
//   {target} a label; {list} a register list; {wb} '!' when w; {caret} '^' when user;
//   {shift} ', lsl #n' / ', rrx' or nothing (shift, amount); {rshift} ', lsl rs' (shift, rs);
//   {const} '#v' or '#imm8, rot' (imm, rot, explicit); {amode} '[rn, #-n]!' forms (rn p u w imm);
//   {amode_reg} '[rn, -rm, lsl #n]!' forms (rn p u w rm shift amount); {hamode_reg} '[rn, -rm]!'
//   forms (rn p u w rm); {psr} cpsr/spsr (r); {psrf} 'cpsr_fc' (r mask).
// A placeholder may appear twice in a parse-only alias; both occurrences must then read one value.
import type { Addr } from './address.js';
import { fieldValue as get, rol32, ror32 } from './bits.js';
import { IsaInvariantError } from './errors.js';
import {
  CONDITIONS,
  SHIFTS,
  num,
  parseNum,
  parsePsrFields,
  parseRegList,
  psrFields,
  regList,
  regName,
  regNumber,
} from './operand-text.js';
import type { Fields } from './types.js';

export interface RenderContext {
  readonly addr: Addr;
  /** The text of an address operand, or undefined when it has no name. */
  label(target: Addr): string | undefined;
}

export interface ReadContext {
  readonly addr: Addr;
  address(name: string): Addr | undefined;
}

type Ops = Record<string, number>;
type Captures = readonly (string | undefined)[];

interface OperandKind {
  /**
   * A sticky regular-expression literal matching the operand text at the reading position. Where it
   * has alternatives, the longer spelling comes first: the reader never backtracks into it.
   */
  readonly re: RegExp;
  render(ops: Fields, key: string, cx: RenderContext): string | undefined;
  read(caps: Captures, key: string, cx: ReadContext, out: Ops): boolean;
}

interface MnemonicKind {
  readonly values: readonly (readonly [string, Fields])[];
  render(ops: Fields): string;
}

/** Records `value` under `key`; false when the key already holds a different value. */
function put(out: Ops, key: string, value: number | undefined): boolean {
  if (value === undefined || !Number.isFinite(value)) {
    return false;
  }
  const old = out[key];
  if (old !== undefined && old !== value) {
    return false;
  }
  out[key] = value;
  return true;
}

/** ', lsl #2', ', rrx' or '' for an immediate shift (shift 4 is rrx). */
function shiftText(shift: number, amount: number): string {
  if (shift === 4) {
    return ', rrx';
  }
  if (shift === 0 && amount === 0) {
    return '';
  }
  return `, ${SHIFTS[shift] ?? 'lsl'} #${num(amount)}`;
}

function readShift(name: string | undefined, amount: string | undefined, rrx: string | undefined, out: Ops): boolean {
  if (rrx !== undefined) {
    return put(out, 'shift', 4) && put(out, 'amount', 0);
  }
  if (name === undefined) {
    return put(out, 'shift', 0) && put(out, 'amount', 0);
  }
  return (
    put(out, 'shift', SHIFTS.indexOf(name)) && put(out, 'amount', amount === undefined ? undefined : parseNum(amount))
  );
}

function sign(ops: Fields): string {
  return get(ops, 'u') === 1 ? '' : '-';
}

function register(): OperandKind {
  return {
    re: /(r1[0-5]|r[0-9]|sp|lr|pc|ip|fp)/y,
    render: (ops, key) => regName(get(ops, key)),
    read: (caps, key, _cx, out) => put(out, key, regNumber(caps[0] ?? '')),
  };
}

// The patterns below share three fragments: a register (r1[0-5]|r[0-9]|sp|lr|pc|ip|fp), the names
// regNumber reads; a number (0x[0-9a-fA-F]+|[0-9]+), what parseNum reads; and a shift
// (?:, (lsl|lsr|asr|ror) #NUM|, (rrx))?. They are literals, so no pattern is built at run time.
const OPERANDS: Readonly<Record<string, OperandKind>> = {
  rd: register(),
  rn: register(),
  rm: register(),
  rs: register(),
  rdlo: register(),
  rdhi: register(),
  imm: {
    re: /#(0x[0-9a-fA-F]+|[0-9]+)/y,
    render: (ops) => `#${num(get(ops, 'imm'))}`,
    read: (caps, _key, _cx, out) => put(out, 'imm', parseNum(caps[0] ?? '')),
  },
  off: {
    re: /(?:, #(0x[0-9a-fA-F]+|[0-9]+))?/y,
    render: (ops) => (get(ops, 'imm') === 0 ? '' : `, #${num(get(ops, 'imm'))}`),
    read: (caps, _key, _cx, out) => put(out, 'imm', caps[0] === undefined ? 0 : parseNum(caps[0])),
  },
  target: {
    re: /([A-Za-z_.$][A-Za-z0-9_.$]*)/y,
    render: (ops, _key, cx) => cx.label(get(ops, 'target')),
    read: (caps, _key, cx, out) => put(out, 'target', cx.address(caps[0] ?? '')),
  },
  list: {
    re: /\{([^}]*)\}/y,
    render: (ops) => regList(get(ops, 'list')),
    read: (caps, _key, _cx, out) => put(out, 'list', parseRegList(caps[0] ?? '')),
  },
  wb: {
    re: /(!)?/y,
    render: (ops) => (get(ops, 'w') === 1 ? '!' : ''),
    read: (caps, _key, _cx, out) => put(out, 'w', caps[0] === undefined ? 0 : 1),
  },
  caret: {
    re: /(\^)?/y,
    render: (ops) => (get(ops, 'user') === 1 ? '^' : ''),
    read: (caps, _key, _cx, out) => put(out, 'user', caps[0] === undefined ? 0 : 1),
  },
  shift: {
    re: /(?:, (lsl|lsr|asr|ror) #(0x[0-9a-fA-F]+|[0-9]+)|, (rrx))?/y,
    render: (ops) => shiftText(get(ops, 'shift'), get(ops, 'amount')),
    read: (caps, _key, _cx, out) => readShift(caps[0], caps[1], caps[2], out),
  },
  rshift: {
    re: /, (lsl|lsr|asr|ror) (r1[0-5]|r[0-9]|sp|lr|pc|ip|fp)/y,
    render: (ops) => `, ${SHIFTS[get(ops, 'shift')] ?? 'lsl'} ${regName(get(ops, 'rs'))}`,
    read: (caps, _key, _cx, out) =>
      put(out, 'shift', SHIFTS.indexOf(caps[0] ?? '')) && put(out, 'rs', regNumber(caps[1] ?? '')),
  },
  const: {
    re: /#(0x[0-9a-fA-F]+|[0-9]+)(?:, ([0-9]+))?/y,
    render: (ops) => {
      const imm = get(ops, 'imm');
      if (get(ops, 'explicit') !== 1) {
        return `#${num(imm)}`;
      }
      const rot = get(ops, 'rot');
      return `#${num(rol32(imm, rot))}, ${rot}`;
    },
    read: (caps, _key, _cx, out) => {
      const value = parseNum(caps[0] ?? '');
      if (value === undefined || value > 0xffff_ffff) {
        return false;
      }
      if (caps[1] === undefined) {
        return put(out, 'imm', value) && put(out, 'explicit', 0);
      }
      const rot = Number.parseInt(caps[1], 10);
      if (value > 0xff || rot > 30 || rot % 2 !== 0) {
        return false;
      }
      return put(out, 'imm', ror32(value, rot)) && put(out, 'rot', rot) && put(out, 'explicit', 1);
    },
  },
  // Post-indexed `[rn], #-n` first, then pre-indexed `[rn, #-n]!` / `[rn]`.
  amode: {
    re: /(?:\[(r1[0-5]|r[0-9]|sp|lr|pc|ip|fp)\], #(-?)(0x[0-9a-fA-F]+|[0-9]+)|\[(r1[0-5]|r[0-9]|sp|lr|pc|ip|fp)(?:, #(-?)(0x[0-9a-fA-F]+|[0-9]+))?\](!)?)/y,
    render: (ops) => {
      const rn = regName(get(ops, 'rn'));
      const imm = get(ops, 'imm');
      if (get(ops, 'p') === 0) {
        return `[${rn}], #${sign(ops)}${num(imm)}`;
      }
      const w = get(ops, 'w') === 1;
      if (imm === 0 && get(ops, 'u') === 1 && !w) {
        return `[${rn}]`;
      }
      return `[${rn}, #${sign(ops)}${num(imm)}]${w ? '!' : ''}`;
    },
    read: (caps, _key, _cx, out) => {
      if (caps[0] !== undefined) {
        return (
          put(out, 'rn', regNumber(caps[0])) &&
          put(out, 'p', 0) &&
          put(out, 'u', caps[1] === '-' ? 0 : 1) &&
          put(out, 'w', 0) &&
          put(out, 'imm', parseNum(caps[2] ?? ''))
        );
      }
      return (
        put(out, 'rn', regNumber(caps[3] ?? '')) &&
        put(out, 'p', 1) &&
        put(out, 'u', caps[4] === '-' ? 0 : 1) &&
        put(out, 'w', caps[6] === undefined ? 0 : 1) &&
        put(out, 'imm', caps[5] === undefined ? 0 : parseNum(caps[5]))
      );
    },
  },
  amode_reg: {
    re: /(?:\[(r1[0-5]|r[0-9]|sp|lr|pc|ip|fp)\], (-?)(r1[0-5]|r[0-9]|sp|lr|pc|ip|fp)(?:, (lsl|lsr|asr|ror) #(0x[0-9a-fA-F]+|[0-9]+)|, (rrx))?|\[(r1[0-5]|r[0-9]|sp|lr|pc|ip|fp), (-?)(r1[0-5]|r[0-9]|sp|lr|pc|ip|fp)(?:, (lsl|lsr|asr|ror) #(0x[0-9a-fA-F]+|[0-9]+)|, (rrx))?\](!)?)/y,
    render: (ops) => {
      const rn = regName(get(ops, 'rn'));
      const index = `${sign(ops)}${regName(get(ops, 'rm'))}${shiftText(get(ops, 'shift'), get(ops, 'amount'))}`;
      if (get(ops, 'p') === 0) {
        return `[${rn}], ${index}`;
      }
      return `[${rn}, ${index}]${get(ops, 'w') === 1 ? '!' : ''}`;
    },
    read: (caps, _key, _cx, out) => {
      const post = caps[0] !== undefined;
      const at = post ? 0 : 6;
      return (
        put(out, 'rn', regNumber(caps[at] ?? '')) &&
        put(out, 'p', post ? 0 : 1) &&
        put(out, 'u', caps[at + 1] === '-' ? 0 : 1) &&
        put(out, 'rm', regNumber(caps[at + 2] ?? '')) &&
        readShift(caps[at + 3], caps[at + 4], caps[at + 5], out) &&
        put(out, 'w', !post && caps[12] !== undefined ? 1 : 0)
      );
    },
  },
  hamode_reg: {
    re: /(?:\[(r1[0-5]|r[0-9]|sp|lr|pc|ip|fp)\], (-?)(r1[0-5]|r[0-9]|sp|lr|pc|ip|fp)|\[(r1[0-5]|r[0-9]|sp|lr|pc|ip|fp), (-?)(r1[0-5]|r[0-9]|sp|lr|pc|ip|fp)\](!)?)/y,
    render: (ops) => {
      const rn = regName(get(ops, 'rn'));
      const index = `${sign(ops)}${regName(get(ops, 'rm'))}`;
      if (get(ops, 'p') === 0) {
        return `[${rn}], ${index}`;
      }
      return `[${rn}, ${index}]${get(ops, 'w') === 1 ? '!' : ''}`;
    },
    read: (caps, _key, _cx, out) => {
      const post = caps[0] !== undefined;
      const at = post ? 0 : 3;
      return (
        put(out, 'rn', regNumber(caps[at] ?? '')) &&
        put(out, 'p', post ? 0 : 1) &&
        put(out, 'u', caps[at + 1] === '-' ? 0 : 1) &&
        put(out, 'rm', regNumber(caps[at + 2] ?? '')) &&
        put(out, 'w', !post && caps[6] !== undefined ? 1 : 0)
      );
    },
  },
  psr: {
    re: /(cpsr|spsr)/y,
    render: (ops) => (get(ops, 'r') === 1 ? 'spsr' : 'cpsr'),
    read: (caps, _key, _cx, out) => put(out, 'r', caps[0] === 'spsr' ? 1 : 0),
  },
  psrf: {
    re: /(cpsr|spsr)_([fsxc]+)/y,
    render: (ops) => `${get(ops, 'r') === 1 ? 'spsr' : 'cpsr'}_${psrFields(get(ops, 'mask'))}`,
    read: (caps, _key, _cx, out) =>
      put(out, 'r', caps[0] === 'spsr' ? 1 : 0) && put(out, 'mask', parsePsrFields(caps[1] ?? '')),
  },
};

const MNEMONIC_PARTS: Readonly<Record<string, MnemonicKind>> = {
  c: {
    values: CONDITIONS.map((suffix, cond) => [suffix, { cond }] as const),
    render: (ops) => CONDITIONS[ops['cond'] ?? 14] ?? '',
  },
  s: {
    values: [
      ['', { s: 0 }],
      ['s', { s: 1 }],
    ],
    render: (ops) => (ops['s'] === 1 ? 's' : ''),
  },
  am: {
    values: [
      ['ia', { p: 0, u: 1 }],
      ['ib', { p: 1, u: 1 }],
      ['da', { p: 0, u: 0 }],
      ['db', { p: 1, u: 0 }],
    ],
    render: (ops) => `${get(ops, 'u') === 1 ? 'i' : 'd'}${get(ops, 'p') === 1 ? 'b' : 'a'}`,
  },
};

type Part =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'mnemonic'; readonly part: MnemonicKind }
  | { readonly kind: 'operand'; readonly operand: OperandKind; readonly key: string };

/** A compiled template: how to render it and how to read it back. */
export interface CompiledForm {
  readonly template: string;
  /** Every concrete mnemonic the template spells, with the operand values its suffixes stand for. */
  readonly mnemonics: readonly (readonly [string, Fields])[];
  readonly parts: readonly Part[];
  /** The index of the first operand part (after the mnemonic and its space). */
  readonly operandsFrom: number;
}

/** Splits a template into literal text and placeholders. */
function tokens(template: string): readonly (readonly [string, boolean])[] {
  const out: [string, boolean][] = [];
  const re = /\{([a-z_]+)\}/g;
  let last = 0;
  for (let m = re.exec(template); m !== null; m = re.exec(template)) {
    if (m.index > last) {
      out.push([template.slice(last, m.index), false]);
    }
    out.push([m[1] ?? '', true]);
    last = m.index + m[0].length;
  }
  if (last < template.length) {
    out.push([template.slice(last), false]);
  }
  return out;
}

/** Compiles a template; throws on an unknown placeholder (a table bug). */
export function compileForm(template: string): CompiledForm {
  const space = template.indexOf(' ');
  const head = space < 0 ? template : template.slice(0, space);
  const tail = space < 0 ? '' : template.slice(space + 1);
  const parts: Part[] = [];

  let mnemonics: (readonly [string, Fields])[] = [['', {}]];
  for (const [text, isPlaceholder] of tokens(head)) {
    if (!isPlaceholder) {
      parts.push({ kind: 'text', text });
      mnemonics = mnemonics.map(([m, ops]) => [m + text, ops] as const);
      continue;
    }
    const part = MNEMONIC_PARTS[text];
    if (part === undefined) {
      throw new IsaInvariantError(`template '${template}': unknown mnemonic placeholder {${text}}`);
    }
    parts.push({ kind: 'mnemonic', part });
    mnemonics = mnemonics.flatMap(([m, ops]) =>
      part.values.map(([suffix, more]) => [m + suffix, { ...ops, ...more }] as const),
    );
  }
  if (space >= 0) {
    parts.push({ kind: 'text', text: ' ' });
  }

  const operandsFrom = parts.length;
  for (const [text, isPlaceholder] of tokens(tail)) {
    if (!isPlaceholder) {
      parts.push({ kind: 'text', text });
      continue;
    }
    const operand = OPERANDS[text];
    if (operand === undefined) {
      throw new IsaInvariantError(`template '${template}': unknown operand placeholder {${text}}`);
    }
    parts.push({ kind: 'operand', operand, key: text });
  }
  return { template, mnemonics, parts, operandsFrom };
}

/** The text of a form for these operand values; undefined when an address operand has no label. */
export function renderForm(form: CompiledForm, ops: Fields, cx: RenderContext): string | undefined {
  let out = '';
  for (const part of form.parts) {
    if (part.kind === 'text') {
      out += part.text;
    } else if (part.kind === 'mnemonic') {
      out += part.part.render(ops);
    } else {
      const text = part.operand.render(ops, part.key, cx);
      if (text === undefined) {
        return undefined;
      }
      out += text;
    }
  }
  return out;
}

/** The operand values of `operandText` read through `form`, merged onto the mnemonic's values. */
export function readForm(
  form: CompiledForm,
  mnemonicOps: Fields,
  operandText: string,
  cx: ReadContext,
): Fields | undefined {
  const out: Ops = { ...mnemonicOps };
  let at = 0;
  for (let i = form.operandsFrom; i < form.parts.length; i++) {
    const part = form.parts[i];
    if (part === undefined || part.kind === 'mnemonic') {
      continue;
    }
    if (part.kind === 'text') {
      if (!operandText.startsWith(part.text, at)) {
        return undefined;
      }
      at += part.text.length;
      continue;
    }
    part.operand.re.lastIndex = at;
    const m = part.operand.re.exec(operandText);
    if (m === null || !part.operand.read(m.slice(1), part.key, cx, out)) {
      return undefined;
    }
    at += m[0].length;
  }
  return at === operandText.length ? out : undefined;
}

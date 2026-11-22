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
import type { Addr } from '../address.js';
import { fieldValue as get, rol32, ror32 } from '../bits.js';
import { IsaInvariantError } from '../errors.js';
import type { Fields } from '../types.js';
import {
  CONDITIONS,
  SHIFTS,
  SHIFT_RRX,
  num,
  parseNum,
  parsePsrFields,
  parseRegList,
  psrFields,
  regList,
  regName,
  regNumber,
} from './operand-text.js';

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
/** The named groups of an operand pattern's match. */
type Groups = Readonly<Record<string, string | undefined>>;

interface OperandKind {
  /** A sticky pattern matching the operand text at the reading position; its captures are named groups. */
  readonly re: RegExp;
  render(ops: Fields, key: string, cx: RenderContext): string | undefined;
  read(groups: Groups, key: string, cx: ReadContext, out: Ops): boolean;
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
  if (shift === SHIFT_RRX) {
    return ', rrx';
  }
  if (shift === 0 && amount === 0) {
    return '';
  }
  return `, ${SHIFTS[shift] ?? 'lsl'} #${num(amount)}`;
}

// The operand patterns are built from three fragments, so each spelling is written once: a register (the names
// regNumber reads), a number (what parseNum reads) and a shift by an immediate. Every capture is a named group,
// and each pattern is sticky: it matches at the reading position and the reader never backtracks into it, so
// where a pattern has alternatives the longer spelling comes first.
const REGISTER = 'r1[0-5]|r[0-9]|sp|lr|pc|ip|fp';
const NUMBER = '0x[0-9a-fA-F]+|[0-9]+';
const SHIFT_NAME = 'lsl|lsr|asr|ror';

const pattern = (source: string): RegExp => new RegExp(source, 'y');
const registerGroup = (name: string): string => `(?<${name}>${REGISTER})`;
const numberGroup = (name: string): string => `(?<${name}>${NUMBER})`;
/** ', lsl #n', ', rrx' or nothing; the groups are `<prefix>Shift`, `<prefix>Amount` and `<prefix>Rrx`. */
const immediateShift = (prefix: string): string =>
  `(?:, (?<${prefix}Shift>${SHIFT_NAME}) #${numberGroup(`${prefix}Amount`)}|, (?<${prefix}Rrx>rrx))?`;

function readShift(groups: Groups, prefix: string, out: Ops): boolean {
  const name = groups[`${prefix}Shift`];
  if (groups[`${prefix}Rrx`] !== undefined) {
    return put(out, 'shift', SHIFT_RRX) && put(out, 'amount', 0);
  }
  if (name === undefined) {
    return put(out, 'shift', 0) && put(out, 'amount', 0);
  }
  return put(out, 'shift', SHIFTS.indexOf(name)) && put(out, 'amount', parseNum(groups[`${prefix}Amount`] ?? ''));
}

function sign(ops: Fields): string {
  return get(ops, 'u') === 1 ? '' : '-';
}

/** The `u` operand of a sign group: '-' subtracts. */
const up = (signText: string | undefined): number => (signText === '-' ? 0 : 1);
const flagOf = (text: string | undefined): number => (text === undefined ? 0 : 1);

function register(): OperandKind {
  return {
    re: pattern(registerGroup('reg')),
    render: (ops, key) => regName(get(ops, key)),
    read: (g, key, _cx, out) => put(out, key, regNumber(g['reg'] ?? '')),
  };
}

/**
 * `[rn], <post>` or `[rn<pre>]!`: the two shapes every ARM addressing mode has. `post` and `pre` are the
 * patterns of the index after the base, each with its own group names.
 */
const addressing = (post: string, pre: string): RegExp =>
  pattern(`\\[${registerGroup('rn')}(?:\\], ${post}|${pre}\\](?<wb>!)?)`);

/** The operands every addressing mode reads: the base, P (pre-indexed), U (add) and W (writeback). */
function readAddressing(g: Groups, postIndexed: boolean, signText: string | undefined, out: Ops): boolean {
  return (
    put(out, 'rn', regNumber(g['rn'] ?? '')) &&
    put(out, 'p', postIndexed ? 0 : 1) &&
    put(out, 'u', up(signText)) &&
    put(out, 'w', postIndexed ? 0 : flagOf(g['wb']))
  );
}

const OPERANDS: Readonly<Record<string, OperandKind>> = {
  rd: register(),
  rn: register(),
  rm: register(),
  rs: register(),
  rdlo: register(),
  rdhi: register(),
  imm: {
    re: pattern(`#${numberGroup('value')}`),
    render: (ops) => `#${num(get(ops, 'imm'))}`,
    read: (g, _key, _cx, out) => put(out, 'imm', parseNum(g['value'] ?? '')),
  },
  off: {
    re: pattern(`(?:, #${numberGroup('value')})?`),
    render: (ops) => (get(ops, 'imm') === 0 ? '' : `, #${num(get(ops, 'imm'))}`),
    read: (g, _key, _cx, out) => put(out, 'imm', g['value'] === undefined ? 0 : parseNum(g['value'])),
  },
  target: {
    re: pattern('(?<label>[A-Za-z_.$][A-Za-z0-9_.$]*)'),
    render: (ops, _key, cx) => cx.label(get(ops, 'target')),
    read: (g, _key, cx, out) => put(out, 'target', cx.address(g['label'] ?? '')),
  },
  list: {
    re: pattern('\\{(?<registers>[^}]*)\\}'),
    render: (ops) => regList(get(ops, 'list')),
    read: (g, _key, _cx, out) => put(out, 'list', parseRegList(g['registers'] ?? '')),
  },
  wb: {
    re: pattern('(?<wb>!)?'),
    render: (ops) => (get(ops, 'w') === 1 ? '!' : ''),
    read: (g, _key, _cx, out) => put(out, 'w', flagOf(g['wb'])),
  },
  caret: {
    re: pattern('(?<caret>\\^)?'),
    render: (ops) => (get(ops, 'user') === 1 ? '^' : ''),
    read: (g, _key, _cx, out) => put(out, 'user', flagOf(g['caret'])),
  },
  shift: {
    re: pattern(immediateShift('by')),
    render: (ops) => shiftText(get(ops, 'shift'), get(ops, 'amount')),
    read: (g, _key, _cx, out) => readShift(g, 'by', out),
  },
  rshift: {
    re: pattern(`, (?<shift>${SHIFT_NAME}) ${registerGroup('rs')}`),
    render: (ops) => `, ${SHIFTS[get(ops, 'shift')] ?? 'lsl'} ${regName(get(ops, 'rs'))}`,
    read: (g, _key, _cx, out) =>
      put(out, 'shift', SHIFTS.indexOf(g['shift'] ?? '')) && put(out, 'rs', regNumber(g['rs'] ?? '')),
  },
  const: {
    re: pattern(`#${numberGroup('value')}(?:, (?<rotation>[0-9]+))?`),
    render: (ops) => {
      const imm = get(ops, 'imm');
      if (get(ops, 'explicit') !== 1) {
        return `#${num(imm)}`;
      }
      const rot = get(ops, 'rot');
      return `#${num(rol32(imm, rot))}, ${rot}`;
    },
    read: (g, _key, _cx, out) => {
      const value = parseNum(g['value'] ?? '');
      if (value === undefined || value > 0xffff_ffff) {
        return false;
      }
      if (g['rotation'] === undefined) {
        return put(out, 'imm', value) && put(out, 'explicit', 0);
      }
      const rot = Number.parseInt(g['rotation'], 10);
      if (value > 0xff || rot > 30 || rot % 2 !== 0) {
        return false;
      }
      return put(out, 'imm', ror32(value, rot)) && put(out, 'rot', rot) && put(out, 'explicit', 1);
    },
  },
  // `[rn], #-n`, `[rn, #-n]!` or `[rn]`.
  amode: {
    re: addressing(`#(?<postSign>-?)${numberGroup('postOffset')}`, `(?:, #(?<preSign>-?)${numberGroup('preOffset')})?`),
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
    read: (g, _key, _cx, out) => {
      if (g['postOffset'] !== undefined) {
        return readAddressing(g, true, g['postSign'], out) && put(out, 'imm', parseNum(g['postOffset']));
      }
      const offset = g['preOffset'];
      return (
        readAddressing(g, false, g['preSign'], out) && put(out, 'imm', offset === undefined ? 0 : parseNum(offset))
      );
    },
  },
  // `[rn], -rm, lsl #n` or `[rn, -rm, lsl #n]!`.
  amode_reg: {
    re: addressing(
      `(?<postSign>-?)${registerGroup('postRm')}${immediateShift('post')}`,
      `, (?<preSign>-?)${registerGroup('preRm')}${immediateShift('pre')}`,
    ),
    render: (ops) => {
      const rn = regName(get(ops, 'rn'));
      const index = `${sign(ops)}${regName(get(ops, 'rm'))}${shiftText(get(ops, 'shift'), get(ops, 'amount'))}`;
      if (get(ops, 'p') === 0) {
        return `[${rn}], ${index}`;
      }
      return `[${rn}, ${index}]${get(ops, 'w') === 1 ? '!' : ''}`;
    },
    read: (g, _key, _cx, out) => {
      const post = g['postRm'] !== undefined;
      const side = post ? 'post' : 'pre';
      return (
        readAddressing(g, post, g[`${side}Sign`], out) &&
        put(out, 'rm', regNumber(g[`${side}Rm`] ?? '')) &&
        readShift(g, side, out)
      );
    },
  },
  // `[rn], -rm` or `[rn, -rm]!`: the halfword forms take no shift.
  hamode_reg: {
    re: addressing(`(?<postSign>-?)${registerGroup('postRm')}`, `, (?<preSign>-?)${registerGroup('preRm')}`),
    render: (ops) => {
      const rn = regName(get(ops, 'rn'));
      const index = `${sign(ops)}${regName(get(ops, 'rm'))}`;
      if (get(ops, 'p') === 0) {
        return `[${rn}], ${index}`;
      }
      return `[${rn}, ${index}]${get(ops, 'w') === 1 ? '!' : ''}`;
    },
    read: (g, _key, _cx, out) => {
      const post = g['postRm'] !== undefined;
      const side = post ? 'post' : 'pre';
      return readAddressing(g, post, g[`${side}Sign`], out) && put(out, 'rm', regNumber(g[`${side}Rm`] ?? ''));
    },
  },
  psr: {
    re: pattern('(?<psr>cpsr|spsr)'),
    render: (ops) => (get(ops, 'r') === 1 ? 'spsr' : 'cpsr'),
    read: (g, _key, _cx, out) => put(out, 'r', g['psr'] === 'spsr' ? 1 : 0),
  },
  psrf: {
    re: pattern('(?<psr>cpsr|spsr)_(?<fields>[fsxc]+)'),
    render: (ops) => `${get(ops, 'r') === 1 ? 'spsr' : 'cpsr'}_${psrFields(get(ops, 'mask'))}`,
    read: (g, _key, _cx, out) =>
      put(out, 'r', g['psr'] === 'spsr' ? 1 : 0) && put(out, 'mask', parsePsrFields(g['fields'] ?? '')),
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
    if (m === null || !part.operand.read(m.groups ?? {}, part.key, cx, out)) {
      return undefined;
    }
    at += m[0].length;
  }
  return at === operandText.length ? out : undefined;
}

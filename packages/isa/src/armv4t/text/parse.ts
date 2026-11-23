// parse(text, mode, addr, resolver): reads exactly the grammar format writes back to the rows
// that accept it and their operand values. Rows are found through an index from concrete mnemonic to
// (row, form), built on the first parse of a mode, then each candidate form's operand pattern is matched.
import type { Addr, Mode } from '../address.js';
import { once } from '../lazy.js';
import { ROWS } from '../tables/registry.js';
import type { Row } from '../tables/row.js';
import type { Operands, ParsedCandidate, ParsedInsn, SymbolResolver } from '../types.js';
import { readForm } from './template.js';
import type { CompiledForm } from './template.js';

interface Entry {
  readonly row: Row;
  readonly form: CompiledForm;
  readonly mnemonicOps: Operands;
}

function buildIndex(rows: readonly Row[]): ReadonlyMap<string, readonly Entry[]> {
  const index = new Map<string, Entry[]>();
  for (const row of rows) {
    if (!row.printable) {
      continue;
    }
    for (const form of row.forms) {
      for (const [mnemonic, mnemonicOps] of form.mnemonics) {
        const list = index.get(mnemonic) ?? [];
        list.push({ row, form, mnemonicOps });
        index.set(mnemonic, list);
      }
    }
  }
  return index;
}

const INDEX: Readonly<Record<Mode, () => ReadonlyMap<string, readonly Entry[]>>> = {
  thumb: once(() => buildIndex(ROWS.thumb)),
  arm: once(() => buildIndex(ROWS.arm)),
};

/** The mnemonic of an instruction text: its first word, in lower case. */
export function mnemonicOf(text: string): string {
  const normal = normalizeInsnText(text);
  const space = normal.indexOf(' ');
  return (space < 0 ? normal : normal.slice(0, space)).toLowerCase();
}

/** The syntax templates of every row a mnemonic spells, once each, in table order; undefined when it spells none. */
export function syntaxesOf(mode: Mode, mnemonic: string): readonly string[] | undefined {
  const entries = INDEX[mode]().get(mnemonic);
  return entries === undefined ? undefined : [...new Set(entries.map((entry) => entry.form.template))];
}

/** One instruction's text with its comment dropped and its spacing made canonical. */
export function normalizeInsnText(text: string): string {
  const at = text.indexOf('@');
  return (at < 0 ? text : text.slice(0, at))
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/([[{])\s+/g, '$1')
    .replace(/\s+([\]}])/g, '$1');
}

/** The rows that accept `text` at `addr` and its operand values; undefined when no row does. */
export function parse(text: string, mode: Mode, addr: Addr, resolver: SymbolResolver): ParsedInsn | undefined {
  const normal = normalizeInsnText(text);
  const space = normal.indexOf(' ');
  const mnemonic = (space < 0 ? normal : normal.slice(0, space)).toLowerCase();
  const operandText = space < 0 ? '' : normal.slice(space + 1);
  const entries = INDEX[mode]().get(mnemonic);
  if (entries === undefined) {
    return undefined;
  }

  const cx = { addr, address: (name: string) => resolver.addressOf(name) };
  const candidates: ParsedCandidate[] = [];
  for (const entry of entries) {
    const specId = entry.row.spec.id;
    if (candidates.some((c) => c.specId === specId)) {
      continue;
    }
    const operands = readForm(entry.form, entry.mnemonicOps, operandText, cx);
    if (operands !== undefined) {
      candidates.push({ specId, operands });
    }
  }
  return candidates.length === 0 ? undefined : { mode, text: normal, mnemonic, candidates };
}

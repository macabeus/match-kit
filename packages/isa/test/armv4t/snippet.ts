// Assembles a few lines of GNU as unified syntax in process, through the package's own parse and assemble, into
// little-endian bytes. Lines are separated by newlines or ';'; `@` starts a comment; `name:` defines a label at the
// next instruction; `_XXXXXXXX` (eight hex digits) names that absolute address.
import { type Mode, type SymbolResolver, assemble, parse } from '../../src/armv4t.js';

function absolute(name: string): number | undefined {
  return /^_[0-9A-Fa-f]{8}$/.test(name) ? Number.parseInt(name.slice(1), 16) : undefined;
}

function statements(text: string): string[] {
  return text
    .split(/[\n;]/)
    .map((line) => line.replace(/@.*$/, '').trim())
    .filter((line) => line !== '');
}

interface Line {
  readonly text: string;
  readonly labels: readonly string[];
}

function lines(text: string): Line[] {
  const out: Line[] = [];
  let pending: string[] = [];
  for (const statement of statements(text)) {
    const label = /^([A-Za-z_.$][A-Za-z0-9_.$]*):\s*(.*)$/.exec(statement);
    if (label !== null) {
      pending.push(label[1] ?? '');
      if ((label[2] ?? '') === '') {
        continue;
      }
    }
    out.push({ text: label === null ? statement : (label[2] ?? ''), labels: pending });
    pending = [];
  }
  if (pending.length > 0) {
    out.push({ text: '', labels: pending });
  }
  return out;
}

/** Assembles `text` in `mode` starting at `origin`; throws on a line that does not assemble. */
export function assembleSnippet(mode: Mode, text: string, origin: number): Uint8Array {
  const program = lines(text);
  // Pass 1: sizes, with every unknown name standing for the instruction's own address.
  const labels = new Map<string, number>();
  let addr = origin;
  for (const line of program) {
    for (const label of line.labels) {
      labels.set(label, addr);
    }
    if (line.text === '') {
      continue;
    }
    const sizing: SymbolResolver = {
      labelFor: () => undefined,
      addressOf: (name) => absolute(name) ?? labels.get(name) ?? addr,
    };
    const parsed = parse(line.text, mode, addr, sizing);
    addr += parsed?.candidates.some((c) => c.specId === 'thumb.bl') ? 4 : mode === 'arm' ? 4 : 2;
  }
  // Pass 2: the bytes.
  const resolver: SymbolResolver = {
    labelFor: () => undefined,
    addressOf: (name) => absolute(name) ?? labels.get(name),
  };
  const bytes: number[] = [];
  addr = origin;
  for (const line of program) {
    if (line.text === '') {
      continue;
    }
    const parsed = parse(line.text, mode, addr, resolver);
    const assembled = parsed === undefined ? undefined : assemble(parsed, addr);
    if (assembled === undefined) {
      throw new Error(`${mode} at 0x${addr.toString(16)}: cannot assemble '${line.text}'`);
    }
    for (let i = 0; i < assembled.size; i++) {
      bytes.push((assembled.word >>> (8 * i)) & 0xff);
    }
    addr += assembled.size;
  }
  return Uint8Array.from(bytes);
}

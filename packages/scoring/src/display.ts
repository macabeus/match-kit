// Text views of an `Inspection`, for reports and prompts. Pure functions: nothing here touches the
// engine.
import type { DiffBreakdown, Inspection } from './index.js';

/** A row that differs, with both sides' text (`''` for a side the row does not reach). */
export interface RowDifference {
  row: number;
  kind: keyof DiffBreakdown;
  target: string;
  candidate: string;
}

/** One side's assembly, a line per row that has text on that side. */
export function assembly(inspection: Inspection, side: 'target' | 'candidate'): string {
  return inspection.rows
    .map((r) => r[side])
    .filter((text): text is string => text !== null && text.trim() !== '')
    .join('\n');
}

/** Every differing row, in order. */
export function differences(inspection: Inspection): RowDifference[] {
  const out: RowDifference[] = [];
  for (const r of inspection.rows) {
    if (r.kind !== 'none') {
      out.push({ row: r.row, kind: r.kind, target: (r.target ?? '').trim(), candidate: (r.candidate ?? '').trim() });
    }
  }
  return out;
}

const COLUMN = 40;

/** Target and candidate side by side, a `|` between them where the row differs. */
export function sideBySide(inspection: Inspection): string {
  const cell = (text: string | null) => (text ?? '').replaceAll('\n', ' ').trim();
  const lines = inspection.rows.map(
    (r) => `${cell(r.target).padEnd(COLUMN)} ${r.kind === 'none' ? '  ' : '| '} ${cell(r.candidate)}`,
  );
  const header = `${'target'.padEnd(COLUMN)}    candidate\n${'─'.repeat(COLUMN)} ── ${'─'.repeat(COLUMN)}`;
  return [header, ...lines].join('\n');
}

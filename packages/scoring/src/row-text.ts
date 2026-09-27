import type * as ObjdiffWasm from 'objdiff-wasm';

/**
 * One instruction row as assembly text, for people and for prompts. Branch targets become
 * `.L<addr>` labels, references are marked `# REFERENCE_`, and DWARF line numbers are left out.
 * Padding follows each segment's `padTo`, so columns line up as objdiff lays them out.
 */
export function rowText(row: ObjdiffWasm.display.InstructionDiffRow): string {
  let text = '';
  let address = '';

  for (const segment of row.segments) {
    const part = segment.text;
    switch (part.tag) {
      case 'basic':
        if (part.val === ' ~>') {
          // objdiff's marker for a branch source: nothing to print.
        } else if (part.val === ' (->') {
          text += ' # REFERENCE_';
        } else if (part.val === ' ~> ') {
          text += `.L${address}:\n`;
        } else if (part.val === ')' && text.includes(' # REFERENCE_')) {
          // The reference's closing paren.
        } else {
          text += part.val;
        }
        break;
      case 'line':
        break;
      case 'address':
        // Kept for the label a later ` ~> ` prints; never printed as a prefix.
        address = part.val.toString(16);
        break;
      case 'opcode':
        text += `${part.val.mnemonic} `;
        break;
      case 'signed':
        text += part.val < 0n ? `-0x${(-part.val).toString(16)}` : `0x${part.val.toString(16)}`;
        break;
      case 'unsigned':
        text += `0x${part.val.toString(16)}`;
        break;
      case 'opaque':
        text += part.val;
        break;
      case 'branch-dest':
        text += `.L${part.val.toString(16)}`;
        break;
      case 'branch-arrow':
        break;
      case 'symbol':
        text += part.val.demangledName || part.val.name;
        break;
      case 'addend':
        text += part.val < 0n ? `-0x${(-part.val).toString(16)}` : `+0x${part.val.toString(16)}`;
        break;
      case 'spacing':
        text += ' '.repeat(part.val);
        break;
      case 'eol':
        break;
    }

    if (segment.padTo > text.length) {
      const lastLine = text.slice(text.lastIndexOf('\n') + 1);
      if (segment.padTo > lastLine.length) {
        text += ' '.repeat(segment.padTo - lastLine.length);
      }
    }
  }

  return text;
}

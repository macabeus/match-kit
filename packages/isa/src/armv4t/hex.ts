/** The two upper-case hex digits of each byte value. */
const BYTE_HEX: readonly string[] = Array.from({ length: 256 }, (_, b) =>
  b.toString(16).toUpperCase().padStart(2, '0'),
);

/** `value` as upper-case hex, zero-padded to `digits`, without a prefix; read as an unsigned 32-bit word. */
export function hex(value: number, digits = 8): string {
  if (digits === 8) {
    // A table lookup per byte is several times faster than toString, toUpperCase and padStart, and gives the same text.
    const v = value >>> 0;
    return `${BYTE_HEX[v >>> 24] ?? ''}${BYTE_HEX[(v >>> 16) & 0xff] ?? ''}${BYTE_HEX[(v >>> 8) & 0xff] ?? ''}${BYTE_HEX[v & 0xff] ?? ''}`;
  }
  return (value >>> 0).toString(16).toUpperCase().padStart(digits, '0');
}

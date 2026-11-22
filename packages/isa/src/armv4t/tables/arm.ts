// The ARM (ARMv4T) rows in decode order (first match wins). Each family lives in its own file; this
// is the one place that fixes their relative order, which decides the shadowing between them: the
// never condition first, the coprocessor and undefined spaces before the transfers that share their
// bits, the multiply, swap and halfword rows before the miscellaneous space, data processing last.
import { ARM_DP_ROWS } from './arm-data-processing.js';
import { ARM_MEMORY_ROWS } from './arm-memory.js';
import {
  ARM_CONTROL_ROWS,
  ARM_MEDIA_UNDEFINED,
  ARM_MISC_ROWS,
  ARM_MULTIPLY_ROWS,
  ARM_NV,
  ARM_UNDEFINED,
} from './arm-misc.js';
import type { Row } from './row.js';

/** Every ARM row in decode order; the last one matches everything. */
export const ARM_ROWS: readonly Row[] = [
  ARM_NV,
  ...ARM_CONTROL_ROWS,
  ...ARM_MEMORY_ROWS.blockTransfers,
  ARM_MEDIA_UNDEFINED,
  ...ARM_MEMORY_ROWS.singleTransfers,
  ...ARM_MULTIPLY_ROWS,
  ...ARM_MEMORY_ROWS.swaps,
  ...ARM_MEMORY_ROWS.halfTransfers,
  ...ARM_MISC_ROWS,
  ...ARM_DP_ROWS,
  ARM_UNDEFINED,
];

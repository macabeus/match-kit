// The numbers the architecture fixes, by name: the special registers and the "always" condition.

/** The stack pointer, r13. */
export const SP = 13;
/** The link register, r14. */
export const LR = 14;
/** The program counter, r15. */
export const PC = 15;

/** The condition field's value that means "always" (al), which prints as no suffix. */
export const COND_AL = 14;

/** One side's symbol is missing from its object. */
export class SymbolNotFoundError extends Error {
  readonly symbol: string;
  readonly side: 'target' | 'candidate';

  constructor(symbol: string, side: 'target' | 'candidate') {
    super(`symbol '${symbol}' not found in ${side} object`);
    this.name = 'SymbolNotFoundError';
    this.symbol = symbol;
    this.side = side;
  }
}

/**
 * The engine could not diff this pair: an object it cannot parse, a row it cannot display or decode,
 * a symbol with no rows. The next pair may still score.
 */
export class UndiffableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'UndiffableError';
  }
}

/**
 * The engine failed and cannot score again in this process: each panic leaks engine memory, and
 * after a few thousand the engine fails every call. Every later call throws this too; restart the
 * process.
 */
export class EngineFailedError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('the objdiff engine failed and cannot score again in this process', options);
    this.name = 'EngineFailedError';
  }
}

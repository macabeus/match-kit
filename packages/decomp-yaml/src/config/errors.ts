/** A decomp.yaml that cannot be read, is not valid YAML, or fails the spec or a tool's schema. */
export class DecompYamlError extends Error {
  /** The decomp.yaml the error is about. */
  readonly path: string;
  /** Each problem found, without the path. */
  readonly problems: readonly string[];

  constructor(path: string, problems: string | readonly string[], options?: { cause?: unknown }) {
    const list = typeof problems === 'string' ? [problems] : problems;
    super(list.map((problem) => `${path}: ${problem}`).join('\n'), options);
    this.name = 'DecompYamlError';
    this.path = path;
    this.problems = list;
  }
}

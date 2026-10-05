/** A compile command template the runner cannot run. */
export class TemplateError extends Error {
  /** The template the error is about. */
  readonly template: string;

  constructor(template: string, problem: string) {
    super(`${problem}: ${template}`);
    this.name = 'TemplateError';
    this.template = template;
  }
}

const KNOWN = ['inputPath', 'outputPath', 'symbol', 'flags'];
const PLACEHOLDER = /\{\{(\w+)\}\}/g;

/** A word the shell reads back as itself without quotes. */
const SHELL_BARE = /^[A-Za-z0-9_@%+=:,./-]+$/;

/** `words` as shell words, quoted only where the shell needs it (`-pragma 'cats off'`). */
function shellWords(words: readonly string[]): string {
  return words.map((w) => (SHELL_BARE.test(w) ? w : `'${w.replaceAll("'", `'\\''`)}'`)).join(' ');
}

/**
 * The command a runner compiles with: `template` with `{{flags}}` filled. Throws a `TemplateError` for a
 * missing path, an unknown placeholder, or `flags` and `{{flags}}` that disagree.
 */
export function checkTemplate(
  template: string,
  flags: readonly string[] | undefined,
): { command: string; takesSymbol: boolean } {
  const names = new Set([...template.matchAll(PLACEHOLDER)].map((m) => m[1]));
  const missing = ['inputPath', 'outputPath'].filter((name) => !names.has(name));
  if (missing.length > 0) {
    throw new TemplateError(template, `compile command lacks ${missing.map((name) => `{{${name}}}`).join(' and ')}`);
  }
  const unknown = [...names].find((name) => !KNOWN.includes(name));
  if (unknown !== undefined) {
    throw new TemplateError(
      template,
      `compile command has an unknown placeholder {{${unknown}}} (known: ${KNOWN.map((name) => `{{${name}}}`).join(', ')})`,
    );
  }
  if (names.has('flags') && flags === undefined) {
    throw new TemplateError(template, 'compile command takes {{flags}}, and no flags were given');
  }
  if (!names.has('flags') && flags !== undefined) {
    throw new TemplateError(template, 'compile command has no {{flags}} to take the flags given');
  }
  return {
    command: flags === undefined ? template : template.replaceAll('{{flags}}', shellWords(flags)),
    takesSymbol: names.has('symbol'),
  };
}

// A path or the symbol reaches the shell as written, so the template owns its quoting
// (`-o "{{outputPath}}.tmp"`), and every such value must be inert to the shell. The symbol can come from
// a pasted assembly label.
const SHELL_SAFE = /^[A-Za-z0-9_./+-]+$/;
const safe = (value: string, what: string): string => {
  if (!SHELL_SAFE.test(value)) {
    throw new Error(`${what} contains shell-unsafe characters, refusing to substitute: ${JSON.stringify(value)}`);
  }
  return value;
};

/** The shell command for one compile. */
export function render(command: string, values: { inputPath: string; outputPath: string; symbol?: string }): string {
  let rendered = command
    .replaceAll('{{inputPath}}', safe(values.inputPath, '{{inputPath}}'))
    .replaceAll('{{outputPath}}', safe(values.outputPath, '{{outputPath}}'));
  if (values.symbol !== undefined) {
    rendered = rendered.replaceAll('{{symbol}}', safe(values.symbol, 'the symbol name'));
  }
  return rendered;
}

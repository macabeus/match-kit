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

const KNOWN = ['inputPath', 'outputPath', 'functionName', 'symbol'];
const PLACEHOLDER = /\{\{(\w+)\}\}/g;

/** What a template takes. Throws a `TemplateError` for a missing path or an unknown placeholder. */
export function checkTemplate(template: string): { takesSymbol: boolean } {
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
  return { takesSymbol: names.has('symbol') || names.has('functionName') };
}

// A value reaches the shell as written, so the template owns its quoting (`-o "{{outputPath}}.tmp"`),
// and every value must be inert to the shell. The symbol can come from a pasted assembly label.
const SHELL_SAFE = /^[A-Za-z0-9_./+-]+$/;
const safe = (value: string, what: string): string => {
  if (!SHELL_SAFE.test(value)) {
    throw new Error(`${what} contains shell-unsafe characters, refusing to substitute: ${JSON.stringify(value)}`);
  }
  return value;
};

/** The command for one compile. */
export function render(template: string, values: { inputPath: string; outputPath: string; symbol?: string }): string {
  let command = template
    .replaceAll('{{inputPath}}', safe(values.inputPath, '{{inputPath}}'))
    .replaceAll('{{outputPath}}', safe(values.outputPath, '{{outputPath}}'));
  if (values.symbol !== undefined) {
    const symbol = safe(values.symbol, 'the symbol name');
    command = command.replaceAll('{{symbol}}', symbol).replaceAll('{{functionName}}', symbol);
  }
  return command;
}

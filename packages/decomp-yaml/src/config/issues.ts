import type { StandardSchemaV1 } from '@standard-schema/spec';

/** One line per issue: the key path in the decomp.yaml, then the schema's message. */
export function issueLines(issues: readonly StandardSchemaV1.Issue[], prefix = ''): string[] {
  return issues.map((issue) => {
    let path = prefix;
    for (const segment of issue.path ?? []) {
      const key = typeof segment === 'object' ? segment.key : segment;
      path += typeof key === 'number' ? `[${key}]` : `${path === '' ? '' : '.'}${String(key)}`;
    }
    return path === '' ? issue.message : `${path}: ${issue.message}`;
  });
}

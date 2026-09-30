import type { StandardSchemaV1 } from '@standard-schema/spec';

import type { LoadedConfig } from '../types.js';
import { DecompYamlError } from './errors.js';

/**
 * Read `tools.<tool>` through the tool's own schema: any Standard Schema, such as a zod, valibot or
 * ArkType schema, that validates synchronously. Returns the schema's output, or `undefined` when
 * there is no config or it has no block for this tool. The schema decides what else the block may
 * hold, including keys it does not name.
 */
export function toolBlock<Schema extends StandardSchemaV1>(
  loaded: LoadedConfig | null,
  tool: string,
  schema: Schema,
): StandardSchemaV1.InferOutput<Schema> | undefined {
  const tools = loaded?.config.tools;
  if (!loaded || !tools || !Object.hasOwn(tools, tool) || tools[tool] === null) {
    return undefined;
  }
  const result = schema['~standard'].validate(tools[tool]);
  if (result instanceof Promise) {
    throw new TypeError(`the schema for tools.${tool} validates asynchronously; toolBlock needs a synchronous schema`);
  }
  if (result.issues) {
    throw new DecompYamlError(
      loaded.path,
      result.issues.map((issue) => `${issuePath(tool, issue.path)}: ${issue.message}`),
    );
  }
  return result.value as StandardSchemaV1.InferOutput<Schema>;
}

function issuePath(tool: string, path: StandardSchemaV1.Issue['path']): string {
  let out = `tools.${tool}`;
  for (const segment of path ?? []) {
    const key = typeof segment === 'object' ? segment.key : segment;
    out += typeof key === 'number' ? `[${key}]` : `.${String(key)}`;
  }
  return out;
}

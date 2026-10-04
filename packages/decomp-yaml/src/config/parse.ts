import YAML from 'yaml';

import type { DecompConfig } from '../types.js';
import { DecompYamlError } from './errors.js';
import { issueLines } from './issues.js';
import { DECOMP_YAML } from './spec.js';

/**
 * Parse a decomp.yaml's text and check it against the decomp_settings spec: every required field,
 * no key the spec does not name outside `tools`, each field of its type. A field left empty
 * (`null`) reads as missing. `path` names the file in errors.
 */
export function parseDecompYaml(text: string, path = 'decomp.yaml'): DecompConfig {
  let parsed: unknown;
  try {
    parsed = YAML.parse(text);
  } catch (error) {
    throw new DecompYamlError(path, `is not valid YAML: ${error instanceof Error ? error.message : error}`, {
      cause: error,
    });
  }
  const result = DECOMP_YAML.safeParse(parsed);
  if (!result.success) {
    throw new DecompYamlError(path, issueLines(result.error.issues));
  }
  return result.data;
}

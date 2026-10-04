// Point every URL of schema.json at this package's version, so a published schema's `$id` names
// the release it ships in. The release runs it after `changeset version` (`pnpm release:version`).
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const { version } = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
const SCHEMA_URL = /cdn\.jsdelivr\.net\/npm\/@match-kit\/decomp-yaml(@[^/]+)?\/schema\.json/g;

for (const file of ['schema.json', 'SPEC.md', 'README.md']) {
  const path = new URL(file, root);
  const text = readFileSync(path, 'utf8');
  writeFileSync(
    path,
    text.replaceAll(SCHEMA_URL, `cdn.jsdelivr.net/npm/@match-kit/decomp-yaml@${version}/schema.json`),
  );
}

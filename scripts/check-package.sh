#!/bin/sh
# The published package, checked as a consumer gets it. The tests and the typecheck resolve
# `#engine` to src/, so only this checks dist/ and the `exports` and `imports` maps. It packs
# @matchkit/scoring, installs the tarball into a throwaway project, and:
#   - imports `.`, `./files` and `./display` and scores a pair on Node (and on Bun, when present);
#   - typechecks a consumer under `node16` and `bundler` resolution, with no custom conditions;
#   - bundles it for the browser with Vite and checks the bundle reaches no Node built-in.
#
# usage: scripts/check-package.sh      (from the repo root)
set -eu

root=$(pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

pnpm --filter @matchkit/scoring build >/dev/null
(cd packages/scoring && pnpm pack --pack-destination "$work" >/dev/null)
tarball=$(ls "$work"/matchkit-scoring-*.tgz)

consumer="$work/consumer"
mkdir -p "$consumer/src"
cd "$consumer"
cp "$root/packages/scoring/test/fixtures/edge/target.o" "$root/packages/scoring/test/fixtures/edge/candidate-diff.o" .
cat > package.json <<'EOF'
{ "name": "consumer", "private": true, "type": "module" }
EOF
npm install --silent --no-audit --no-fund "$tarball" typescript@6.0.3 @types/node@24 vite@8 >/dev/null

cat > smoke.mjs <<'EOF'
import { readFileSync } from 'node:fs';
import { OBJDIFF_VERSION, createScorer } from '@matchkit/scoring';
import { sideBySide } from '@matchkit/scoring/display';
import { releaseTarget, scoreFiles } from '@matchkit/scoring/files';

const fromFiles = scoreFiles('target.o', 'candidate-diff.o', 'add_one');
const scorer = await createScorer();
const target = scorer.parseTarget(new Uint8Array(readFileSync('target.o')));
const inspection = scorer.inspect(target, new Uint8Array(readFileSync('candidate-diff.o')), 'add_one');
if (fromFiles.score !== 1 || inspection.score.score !== 1 || !sideBySide(inspection).includes('| ')) {
  throw new Error(`unexpected result: ${JSON.stringify(fromFiles)}`);
}
target.dispose();
scorer.dispose();
releaseTarget();
console.log(`ok ${OBJDIFF_VERSION} score ${fromFiles.score}`);
EOF
printf 'node: '
node smoke.mjs
if command -v bun >/dev/null 2>&1; then
  printf 'bun:  '
  bun smoke.mjs
fi

cat > src/consumer.ts <<'EOF'
import { type MatchScore, createScorer } from '@matchkit/scoring';
import { differences } from '@matchkit/scoring/display';
import { scoreFiles } from '@matchkit/scoring/files';

const scorer = await createScorer();
const score: MatchScore = scoreFiles('target.o', 'candidate-diff.o', 'add_one');
const kinds: string[] = differences(scorer.inspect(scorer.parseTarget(new Uint8Array()), new Uint8Array(), 'f')).map(
  (d) => d.kind,
);
export { score, kinds };
EOF
for resolution in node16 bundler; do
  module=$([ "$resolution" = node16 ] && echo node16 || echo esnext)
  printf 'tsc (%s): ' "$resolution"
  npx tsc --noEmit --strict --target es2022 --module "$module" --moduleResolution "$resolution" --types node \
    --skipLibCheck false src/consumer.ts
  echo ok
done

cat > index.html <<'EOF'
<!doctype html><script type="module" src="/src/browser.ts"></script>
EOF
cat > src/browser.ts <<'EOF'
import { createScorer } from '@matchkit/scoring';

(await createScorer()).dispose();
EOF
cat > vite.config.mjs <<'EOF'
export default { build: { target: 'es2022' }, optimizeDeps: { exclude: ['objdiff-wasm'] } };
EOF
printf 'vite build: '
npx vite build --logLevel error >/dev/null
if grep -l 'node:' dist/assets/*.js >/dev/null 2>&1; then
  echo 'the browser bundle reaches a Node built-in'
  exit 1
fi
ls dist/assets | grep -q 'objdiff.core.*\.wasm' || { echo 'the browser bundle has no objdiff wasm'; exit 1; }
echo ok

import { playwright } from '@vitest/browser-playwright';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = (file: string) => fileURLToPath(new URL(`./packages/scoring/src/${file}`, import.meta.url));

// Two projects over the sources, so tests never need a build:
//   node    — every `*.test.ts`; `pnpm test:bun` runs it under Bun
//   browser — every `*.browser.test.ts`, in headless Chromium
// Each project points `#engine` at its runtime's loader.
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias: { '#engine': src('engine/load-node-bun.ts') } },
        test: {
          name: 'node',
          environment: 'node',
          include: ['packages/*/test/**/*.test.ts'],
          exclude: ['**/*.browser.test.ts', '**/node_modules/**'],
        },
      },
      {
        resolve: { alias: { '#engine': src('engine/load-browser.ts') } },
        optimizeDeps: { exclude: ['objdiff-wasm'] },
        test: {
          name: 'browser',
          include: ['packages/*/test/**/*.browser.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
  },
});

// What `pnpm check-deps` enforces: a browser-safe module never reaches a Node built-in, or a
// browser bundle breaks at import time, which no Node test notices. Every module is browser-safe
// unless listed in NODE_ONLY.
const NODE_ONLY = [
  '^packages/scoring/src/files\\.ts$',
  '^packages/scoring/src/engine/load-node-bun\\.ts$',
  '^packages/decomp-yaml/src/files\\.ts$',
];

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'browser-safe-reaches-node',
      comment: 'A browser-safe module imports a Node built-in. Move the code to a Node-only module (see NODE_ONLY).',
      severity: 'error',
      from: { path: '^packages/[^/]+/src/', pathNot: NODE_ONLY },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'browser-safe-reaches-node-only',
      comment: 'A browser-safe module imports a Node-only module of this repo.',
      severity: 'error',
      from: { path: '^packages/[^/]+/src/', pathNot: NODE_ONLY },
      to: { path: NODE_ONLY },
    },
    {
      name: 'no-bun-api',
      comment: 'Packages run on Node, Bun and browsers alike: no Bun-only module.',
      severity: 'error',
      from: { path: '^packages/[^/]+/src/' },
      to: { path: '^bun(:|$)' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
    // Explicit extensions, so `.ts` imports resolve under any TypeScript version.
    enhancedResolveOptions: {
      extensions: ['.ts', '.js', '.json'],
      // Resolve as a browser bundle does, so `#engine` lands on engine/load-browser.ts and the graph
      // checked is the one a browser loads.
      conditionNames: ['match-kit-source', 'browser', 'import', 'types', 'default'],
    },
  },
};

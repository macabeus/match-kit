import typescriptEslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import unusedImports from 'eslint-plugin-unused-imports';

// The same rules as asmlift and Transmuter, so code moves between the three repos unchanged.
export default [
  {
    ignores: ['**/dist/**', '**/node_modules/**', '.vitest/**'],
  },
  {
    files: ['**/*.ts', '**/*.mjs', '**/*.cjs'],
    plugins: {
      '@typescript-eslint': typescriptEslint,
      'unused-imports': unusedImports,
    },
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/naming-convention': ['warn', { selector: 'import', format: ['camelCase', 'PascalCase'] }],
      curly: 'warn',
      eqeqeq: 'warn',
      'no-throw-literal': 'warn',
      semi: 'warn',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'warn',
        { vars: 'all', varsIgnorePattern: '^_', args: 'after-used', argsIgnorePattern: '^_' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: ':matches(PropertyDefinition, MethodDefinition)[accessibility="private"]',
          message: 'Use #private instead',
        },
      ],
    },
  },
  {
    // Browser-safe modules: a Node or Bun global passes every test here and breaks the first
    // browser that loads the module. `pnpm check-deps` covers imports; this covers globals. The
    // ignored files are NODE_ONLY in .dependency-cruiser.cjs.
    files: ['packages/*/src/**/*.ts'],
    ignores: [
      'packages/scoring/src/files.ts',
      'packages/scoring/src/engine/load-node-bun.ts',
      'packages/decomp-yaml/src/files.ts',
      'packages/compiler/src/**',
    ],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'process', message: 'Node-only: move this to a Node-only module.' },
        { name: 'Buffer', message: 'Node-only: use Uint8Array.' },
        { name: 'Bun', message: 'Bun-only: packages run on Node, Bun and browsers.' },
        { name: '__dirname', message: 'Node-only: move this to a Node-only module.' },
        { name: 'require', message: 'Node-only: use an import.' },
      ],
    },
  },
];

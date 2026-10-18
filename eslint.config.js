import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.vite/**',
      '**/node_modules/**',
      'research/**',
      'content/**',
      'docs/**',
      'scripts/**',
      'benchmarks/**',
      'apps/web/playwright-report/**',
      'apps/web/test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    // The engine runs in the browser and in Node: no Node built-ins and no host globals outside
    // cli/ and tests. XML goes through @xmldom/xmldom (imported in io/musicxml/dom.ts), which is
    // why DOMParser and XMLSerializer are restricted as globals but not as imports.
    files: ['packages/engine/src/**/*.ts'],
    ignores: ['packages/engine/src/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', 'fs', 'path', 'child_process'],
              message: 'Engine code must run in the browser; Node APIs belong in cli/.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        ...['process', 'window', 'document', 'DOMParser', 'XMLSerializer'].map((name) => ({
          name,
          message: 'Engine code must not depend on a host global; see io/musicxml/dom.ts for XML.',
        })),
      ],
    },
  },
  {
    // Only the two classic hook rules: eslint-plugin-react-hooks 7 also ships React Compiler
    // rules in its recommended preset, which this app does not use.
    files: ['apps/web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
);
